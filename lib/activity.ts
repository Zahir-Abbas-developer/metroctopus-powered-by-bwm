import { prisma } from "@/lib/prisma";
import { MILESTONE_STATUS_LABEL, type MilestoneStatus } from "@/lib/constants";
import { formatDate } from "@/lib/date";
import { formatPoints, SCORE_EVENT_LABEL, type ScoreEventType } from "@/lib/scoring";
import type { BadgeTone } from "@/components/ui/Badge";

/**
 * The audit trail.
 *
 * Entries are written by the routes that change things, not by triggers, so
 * each one can carry a sentence a person can read. Like notifications, a
 * failure here is swallowed: losing a log line must never roll back the work
 * it was describing.
 */

export const ACTIVITY_TYPES = [
  "MILESTONE_CREATED",
  "STATUS_CHANGED",
  "REASSIGNED",
  "DUE_DATE_CHANGED",
  "SCORE_EVENT",
  "COMMENT_ADDED",
  "ATTACHMENT_ADDED",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TONE: Record<ActivityType, BadgeTone> = {
  MILESTONE_CREATED: "neutral",
  STATUS_CHANGED: "info",
  REASSIGNED: "info",
  DUE_DATE_CHANGED: "warning",
  SCORE_EVENT: "danger",
  COMMENT_ADDED: "neutral",
  ATTACHMENT_ADDED: "neutral",
};

export async function record(input: {
  type: ActivityType;
  summary: string;
  detail?: string | null;
  milestoneId?: string | null;
  actorId?: string | null;
}): Promise<void> {
  try {
    await prisma.activity.create({
      data: {
        type: input.type,
        summary: input.summary,
        detail: input.detail ?? null,
        milestoneId: input.milestoneId ?? null,
        actorId: input.actorId ?? null,
      },
    });
  } catch (error) {
    console.error("activity log failed", error);
  }
}

export function recordStatusChange(input: {
  milestoneId: string;
  title: string;
  from: MilestoneStatus;
  to: MilestoneStatus;
  actorId: string | null;
  reason?: string | null;
}) {
  const rejection = input.from === "SUBMITTED" && input.to === "IN_PROGRESS";

  return record({
    type: "STATUS_CHANGED",
    milestoneId: input.milestoneId,
    actorId: input.actorId,
    summary: rejection
      ? `sent "${input.title}" back for rework`
      : `moved "${input.title}" from ${MILESTONE_STATUS_LABEL[input.from]} to ${MILESTONE_STATUS_LABEL[input.to]}`,
    detail: input.reason ?? null,
  });
}

export function recordReassignment(input: {
  milestoneId: string;
  title: string;
  fromName: string | null;
  toName: string | null;
  actorId: string | null;
}) {
  const summary = input.toName
    ? input.fromName
      ? `reassigned "${input.title}" from ${input.fromName} to ${input.toName}`
      : `assigned "${input.title}" to ${input.toName}`
    : `unassigned "${input.title}"`;

  return record({
    type: "REASSIGNED",
    milestoneId: input.milestoneId,
    actorId: input.actorId,
    summary,
  });
}

export function recordDueDateChange(input: {
  milestoneId: string;
  title: string;
  from: Date;
  to: Date;
  actorId: string | null;
}) {
  return record({
    type: "DUE_DATE_CHANGED",
    milestoneId: input.milestoneId,
    actorId: input.actorId,
    summary: `moved the deadline for "${input.title}"`,
    detail: `${formatDate(input.from)} → ${formatDate(input.to)}`,
  });
}

export function recordScoreEvent(input: {
  milestoneId: string | null;
  userName: string;
  type: ScoreEventType;
  points: number;
  reason: string;
  actorId?: string | null;
}) {
  return record({
    type: "SCORE_EVENT",
    milestoneId: input.milestoneId,
    actorId: input.actorId ?? null,
    summary: `${formatPoints(input.points)} for ${input.userName} — ${SCORE_EVENT_LABEL[input.type].toLowerCase()}`,
    detail: input.reason,
  });
}

export function recordComment(input: {
  milestoneId: string;
  title: string;
  actorId: string;
  excerpt: string;
}) {
  return record({
    type: "COMMENT_ADDED",
    milestoneId: input.milestoneId,
    actorId: input.actorId,
    summary: `commented on "${input.title}"`,
    detail: input.excerpt,
  });
}

export function recordAttachment(input: {
  milestoneId: string;
  title: string;
  actorId: string;
  filename: string;
}) {
  return record({
    type: "ATTACHMENT_ADDED",
    milestoneId: input.milestoneId,
    actorId: input.actorId,
    summary: `attached ${input.filename} to "${input.title}"`,
  });
}

export type ActivityRow = {
  id: string;
  type: ActivityType;
  summary: string;
  detail: string | null;
  createdAt: Date;
  actor: { id: string; name: string; avatarColor: string } | null;
  milestone: { id: string; title: string; clientName: string } | null;
};

/** The workspace feed, newest first. */
export async function recentActivity(take = 20): Promise<ActivityRow[]> {
  const rows = await prisma.activity.findMany({
    orderBy: { createdAt: "desc" },
    take,
    include: {
      actor: { select: { id: true, name: true, avatarColor: true } },
      milestone: {
        select: {
          id: true,
          title: true,
          module: {
            select: { project: { select: { client: { select: { businessName: true } } } } },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type as ActivityType,
    summary: row.summary,
    detail: row.detail,
    createdAt: row.createdAt,
    actor: row.actor,
    milestone: row.milestone
      ? {
          id: row.milestone.id,
          title: row.milestone.title,
          clientName: row.milestone.module.project.client.businessName,
        }
      : null,
  }));
}
