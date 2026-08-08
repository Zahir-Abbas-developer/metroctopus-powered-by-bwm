import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { sendPush } from "@/lib/reach";
import { getSettings } from "@/lib/settings";
import { agencyToday } from "@/lib/date";
import { routeReview } from "@/lib/permissions";
import { adminIds, leadsByService } from "@/lib/permissions-service";
import { reviewAge, type ReviewAge } from "@/lib/fairness-types";

export * from "@/lib/fairness-types";

/**
 * The owner's side of the bargain.
 *
 * Phase 8 took review time out of members' scores. The other half of that
 * trade is that the wait becomes visible and chased: work sitting in the queue
 * is now the owner's number, tracked and reported like any other.
 *
 * Deliberately no penalty attached. The owner has no monthly score to deduct
 * from, and inventing one would be theatre. What changes behaviour here is the
 * queue being on the dashboard with an age on every row, and a notification
 * every day something is stale.
 */

export type PendingReview = {
  id: string;
  title: string;
  weight: number;
  submittedAt: Date;
  waitingHours: number;
  age: ReviewAge;
  assignee: { id: string; name: string; avatarColor: string } | null;
  clientName: string;
  moduleName: string;
  /** Whose queue this belongs in first. Null when only the owner can act. */
  lead: { id: string; name: string } | null;
  /** True once the owner has been pulled in as well. */
  escalated: boolean;
  /** Everyone who may act on it right now. */
  reviewerIds: string[];
};

/**
 * Everything submitted and not yet decided, longest wait first.
 *
 * Each row carries where it is routed. A submission goes to its service lead
 * first; after the escalation window the owner is added rather than the lead
 * being removed, so delegation cannot become a place work goes to die without
 * punishing a lead for a busy Tuesday.
 *
 * `viewerId` filters to what that person may actually act on — the owner sees
 * everything, a lead sees their lines.
 */
export async function pendingReviews(
  now = new Date(),
  viewerId?: string,
): Promise<PendingReview[]> {
  const settings = await getSettings();

  const submitted = await prisma.milestone.findMany({
    where: { status: "SUBMITTED", submittedAt: { not: null } },
    orderBy: { submittedAt: "asc" },
    include: {
      assignee: { select: { id: true, name: true, avatarColor: true } },
      module: {
        select: {
          name: true,
          serviceId: true,
          project: { select: { client: { select: { businessName: true } } } },
        },
      },
    },
  });

  const serviceIds = [
    ...new Set(
      submitted
        .map((milestone) => milestone.module.serviceId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [leads, admins] = await Promise.all([
    leadsByService(serviceIds),
    adminIds(),
  ]);

  const rows = submitted.map((milestone) => {
    const waitingHours = Math.max(
      0,
      (now.getTime() - milestone.submittedAt!.getTime()) / 3_600_000,
    );

    const serviceLeads = milestone.module.serviceId
      ? (leads.get(milestone.module.serviceId) ?? [])
      : [];

    const route = routeReview({
      assigneeId: milestone.assigneeId,
      serviceId: milestone.module.serviceId,
      serviceLeadIds: serviceLeads.map((lead) => lead.id),
      adminIds: admins,
      waitingHours,
      escalationHours: settings.leadEscalationHours,
    });

    return {
      id: milestone.id,
      title: milestone.title,
      weight: milestone.weight,
      submittedAt: milestone.submittedAt!,
      waitingHours: Math.round(waitingHours * 10) / 10,
      age: reviewAge(waitingHours),
      assignee: milestone.assignee,
      clientName: milestone.module.project.client.businessName,
      moduleName: milestone.module.name,
      lead: serviceLeads.find((lead) => lead.id === route.leadUserId) ?? null,
      escalated: route.escalated,
      reviewerIds: [...route.reviewerIds],
    };
  });

  return viewerId ? rows.filter((row) => row.reviewerIds.includes(viewerId)) : rows;
}

export type ReviewStats = {
  /** Mean minutes from submission to decision, over decided work. */
  averageMinutes: number | null;
  decided: number;
  /** Currently waiting. */
  queued: number;
  stale: number;
  longestWaitHours: number | null;
};

/**
 * The owner's review record. Scoped to decisions in the given window so the
 * monthly summary describes that month rather than all time.
 */
export async function reviewStats(
  options: { since?: Date; until?: Date; now?: Date; viewerId?: string } = {},
): Promise<ReviewStats> {
  const now = options.now ?? new Date();

  const decided = await prisma.milestone.findMany({
    where: {
      adminReviewMinutes: { not: null },
      ...(options.since || options.until
        ? {
            updatedAt: {
              ...(options.since ? { gte: options.since } : {}),
              ...(options.until ? { lt: options.until } : {}),
            },
          }
        : {}),
    },
    select: { adminReviewMinutes: true },
  });

  const queue = await pendingReviews(now, options.viewerId);

  const total = decided.reduce((sum, row) => sum + (row.adminReviewMinutes ?? 0), 0);

  return {
    averageMinutes: decided.length === 0 ? null : Math.round(total / decided.length),
    decided: decided.length,
    queued: queue.length,
    stale: queue.filter((row) => row.age === "STALE").length,
    longestWaitHours: queue.length === 0 ? null : queue[0].waitingHours,
  };
}

/**
 * Average decision time per reviewer.
 *
 * The owner's number was the Phase 8 bargain for taking review time out of
 * members' scores. Delegation means leads now inherit the same accountability —
 * a lead who sits on approvals is doing the same damage the owner was, and
 * measuring only the owner would quietly exempt them.
 */
export async function reviewTimesByReviewer(): Promise<
  { userId: string; name: string; decided: number; averageMinutes: number }[]
> {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: ["MILESTONE_APPROVED", "MILESTONE_REJECTED"] },
      actorId: { not: null },
    },
    select: { actorId: true, entityId: true, actor: { select: { name: true } } },
  });

  const milestoneIds = [
    ...new Set(rows.map((row) => row.entityId).filter((id): id is string => Boolean(id))),
  ];

  const minutes = new Map(
    (
      await prisma.milestone.findMany({
        where: { id: { in: milestoneIds }, adminReviewMinutes: { not: null } },
        select: { id: true, adminReviewMinutes: true },
      })
    ).map((milestone) => [milestone.id, milestone.adminReviewMinutes ?? 0]),
  );

  const byActor = new Map<string, { name: string; total: number; count: number }>();
  for (const row of rows) {
    if (!row.actorId || !row.entityId) continue;
    const value = minutes.get(row.entityId);
    if (value === undefined) continue;

    const entry = byActor.get(row.actorId) ?? { name: row.actor?.name ?? "Unknown", total: 0, count: 0 };
    entry.total += value;
    entry.count += 1;
    byActor.set(row.actorId, entry);
  }

  return [...byActor]
    .map(([userId, entry]) => ({
      userId,
      name: entry.name,
      decided: entry.count,
      averageMinutes: Math.round(entry.total / entry.count),
    }))
    .sort((a, b) => b.averageMinutes - a.averageMinutes);
}

/**
 * Chases the owner about work that has been waiting too long.
 *
 * One notice per stale milestone per day — the dedupe key is per day, so an
 * hourly schedule produces a daily nudge rather than a stream, and it keeps
 * arriving until the queue is cleared.
 */
export async function chaseStaleReviews(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const queue = await pendingReviews(now);
  const stale = queue.filter((row) => row.waitingHours >= settings.reviewSlaHours);

  if (stale.length === 0) return 0;

  const owners = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  const today = agencyToday(now);

  let sent = 0;

  for (const owner of owners) {
    for (const row of stale) {
      const created = await notify({
        userId: owner.id,
        type: "REVIEW_OVERDUE",
        title: "Review overdue",
        body: `"${row.title}" has been waiting ${Math.round(row.waitingHours)}h for your decision — ${
          row.assignee?.name ?? "the assignee"
        } is blocked on it.`,
        href: "/dashboard",
        milestoneId: row.id,
        dedupeKey: `review-overdue:${row.id}:${today}`,
      });
      if (created) sent += 1;
    }

    if (sent > 0) {
      await sendPush(owner.id, {
        title: `${stale.length} review${stale.length === 1 ? "" : "s"} overdue`,
        body:
          stale.length === 1
            ? `"${stale[0].title}" has been waiting ${Math.round(stale[0].waitingHours)}h.`
            : `The longest has been waiting ${Math.round(stale[0].waitingHours)}h.`,
        url: "/dashboard",
        tag: "review-overdue",
      });
    }
  }

  return sent;
}
