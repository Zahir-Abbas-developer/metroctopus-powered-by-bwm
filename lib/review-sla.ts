import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { sendPush } from "@/lib/reach";
import { getSettings } from "@/lib/settings";
import { agencyToday } from "@/lib/date";
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
};

/** Everything submitted and not yet decided, longest wait first. */
export async function pendingReviews(now = new Date()): Promise<PendingReview[]> {
  const submitted = await prisma.milestone.findMany({
    where: { status: "SUBMITTED", submittedAt: { not: null } },
    orderBy: { submittedAt: "asc" },
    include: {
      assignee: { select: { id: true, name: true, avatarColor: true } },
      module: {
        select: {
          name: true,
          project: { select: { client: { select: { businessName: true } } } },
        },
      },
    },
  });

  return submitted.map((milestone) => {
    const waitingHours = Math.max(
      0,
      (now.getTime() - milestone.submittedAt!.getTime()) / 3_600_000,
    );

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
    };
  });
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
  options: { since?: Date; until?: Date; now?: Date } = {},
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

  const queue = await pendingReviews(now);

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
