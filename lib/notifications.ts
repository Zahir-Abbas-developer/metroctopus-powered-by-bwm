import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/score-service";
import { formatDate } from "@/lib/date";
import type { BadgeTone } from "@/components/ui/Badge";

/**
 * In-app notifications. No email yet — that's a later phase, and the model is
 * shaped so adding a delivery channel doesn't change any of the call sites.
 *
 * Emitters never throw into their caller: a notification failing to write must
 * not roll back the approval or assignment that triggered it.
 */

export const NOTIFICATION_TYPES = [
  "TASK_ASSIGNED",
  "DUE_TOMORROW",
  "OVERDUE",
  "WORK_APPROVED",
  "WORK_REJECTED",
  "REPORT_READY",
  // Phase 8 — availability checks stop borrowing DUE_TOMORROW, and the owner
  // gets a type of their own for review work that has gone stale.
  "AVAILABILITY_CHECK",
  "REVIEW_OVERDUE",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TONE: Record<NotificationType, BadgeTone> = {
  TASK_ASSIGNED: "info",
  DUE_TOMORROW: "warning",
  OVERDUE: "danger",
  WORK_APPROVED: "success",
  WORK_REJECTED: "danger",
  REPORT_READY: "neutral",
  AVAILABILITY_CHECK: "warning",
  REVIEW_OVERDUE: "danger",
};

export type NotifyInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string | null;
  milestoneId?: string | null;
  reportId?: string | null;
  /** Set for anything a repeated job could otherwise duplicate. */
  dedupeKey?: string | null;
};

export async function notify(input: NotifyInput): Promise<boolean> {
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href ?? null,
        milestoneId: input.milestoneId ?? null,
        reportId: input.reportId ?? null,
        dedupeKey: input.dedupeKey ?? null,
      },
    });
    return true;
  } catch (error) {
    // A duplicate is the expected outcome of a re-run, not a failure.
    if (isUniqueViolation(error)) return false;
    console.error("notification failed", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Event emitters
// ---------------------------------------------------------------------------

/** The client a workstream belongs to, for notification copy. */
export async function clientNameForModule(moduleId: string): Promise<string | null> {
  const found = await prisma.module.findUnique({
    where: { id: moduleId },
    select: { project: { select: { client: { select: { businessName: true } } } } },
  });
  return found?.project.client.businessName ?? null;
}

export async function notifyAssigned(milestone: {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string;
  clientName?: string | null;
}) {
  return notify({
    userId: milestone.assigneeId,
    type: "TASK_ASSIGNED",
    title: "New milestone assigned to you",
    body: `${milestone.title}${milestone.clientName ? ` · ${milestone.clientName}` : ""} — due ${formatDate(milestone.dueDate)}.`,
    href: "/my-tasks",
    milestoneId: milestone.id,
  });
}

export async function notifyApproved(milestone: {
  id: string;
  title: string;
  assigneeId: string;
  points: number;
}) {
  const impact =
    milestone.points > 0
      ? ` You earned ${milestone.points} point${milestone.points === 1 ? "" : "s"} for delivering early.`
      : milestone.points < 0
        ? ` ${Math.abs(milestone.points)} point${Math.abs(milestone.points) === 1 ? "" : "s"} came off for the late delivery.`
        : "";

  return notify({
    userId: milestone.assigneeId,
    type: "WORK_APPROVED",
    title: "Your work was approved",
    body: `${milestone.title} is signed off.${impact}`,
    href: "/my-tasks",
    milestoneId: milestone.id,
  });
}

export async function notifyRejected(milestone: {
  id: string;
  title: string;
  assigneeId: string;
  reason: string;
  points: number;
}) {
  return notify({
    userId: milestone.assigneeId,
    type: "WORK_REJECTED",
    title: "Work sent back for rework",
    body: `${milestone.title}: ${milestone.reason} (${Math.abs(milestone.points)} points deducted.)`,
    href: "/my-tasks",
    milestoneId: milestone.id,
  });
}

/**
 * Deadline warnings, raised by the evaluation pass.
 *
 * The dedupe key is per milestone per day, so a job that runs hourly still
 * produces one "due tomorrow" and one "overdue" notice rather than a stream.
 */
export async function notifyDueTomorrow(milestone: {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string;
}, today: string) {
  return notify({
    userId: milestone.assigneeId,
    type: "DUE_TOMORROW",
    title: "Due tomorrow",
    body: `${milestone.title} is due ${formatDate(milestone.dueDate)}.`,
    href: "/my-tasks",
    milestoneId: milestone.id,
    dedupeKey: `due-tomorrow:${milestone.id}:${today}`,
  });
}

export async function notifyOverdue(milestone: {
  id: string;
  title: string;
  dueDate: Date;
  assigneeId: string;
}, today: string) {
  return notify({
    userId: milestone.assigneeId,
    type: "OVERDUE",
    title: "Overdue",
    body: `${milestone.title} passed its deadline on ${formatDate(milestone.dueDate)}.`,
    href: "/my-tasks",
    milestoneId: milestone.id,
    dedupeKey: `overdue:${milestone.id}:${today}`,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function recentFor(userId: string, take = 20) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take,
  });
}
