import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { agencyYearMonth, dueDeadline, previousYearMonth } from "@/lib/date";
import {
  MONTHLY_BASELINE,
  effectiveDeadline,
  monthlyScore,
  scoreBand,
  type ProposedEvent,
  type ScoreBand,
} from "@/lib/scoring";

/**
 * The database side of scoring: turning the pure engine's proposals into
 * ledger rows, and projecting those rows back into scores.
 *
 * All the arithmetic lives in lib/scoring.ts. Nothing here decides how many
 * points anything is worth.
 */

export type Cycle = { year: number; month: number };

export function currentCycle(now: Date = new Date()): Cycle {
  return agencyYearMonth(now);
}

/**
 * Writes proposals to the ledger, skipping any whose dedupe key is already
 * present. That unique-index collision is exactly what makes re-running the
 * evaluation job safe — the second attempt is a no-op, not a second charge.
 *
 * SQLite's createMany has no skipDuplicates, so this inserts one at a time and
 * swallows the constraint error. Volumes here are per-project, not per-row-of-
 * a-warehouse, so the cost is irrelevant.
 */
export async function applyEvents(
  proposals: readonly ProposedEvent[],
  options: { at?: Date; createdById?: string | null } = {},
): Promise<number> {
  let applied = 0;

  for (const proposal of proposals) {
    const at = options.at ?? new Date();
    const cycle = agencyYearMonth(at);

    try {
      await prisma.scoreEvent.create({
        data: {
          userId: proposal.userId,
          milestoneId: proposal.milestoneId ?? null,
          type: proposal.type,
          points: proposal.points,
          reason: proposal.reason,
          dedupeKey: proposal.dedupeKey,
          year: cycle.year,
          month: cycle.month,
          createdById: options.createdById ?? null,
          createdAt: at,
        },
      });
      applied += 1;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Already charged for this milestone and type. Nothing to do.
    }
  }

  return applied;
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}

export type MemberScore = {
  userId: string;
  score: number;
  band: ScoreBand;
  /** Difference against the previous calendar month, or null with no history. */
  trend: number | null;
  eventCount: number;
  deductions: number;
  bonuses: number;
};

/** Scores for a set of members in one cycle, derived entirely from events. */
export async function scoresForCycle(
  userIds: readonly string[],
  cycle: Cycle,
): Promise<Map<string, MemberScore>> {
  if (userIds.length === 0) return new Map();

  const previous = previousYearMonth(cycle);

  const [thisMonth, lastMonth] = await Promise.all([
    prisma.scoreEvent.findMany({
      where: { userId: { in: [...userIds] }, year: cycle.year, month: cycle.month },
      select: { userId: true, points: true },
    }),
    prisma.scoreEvent.findMany({
      where: { userId: { in: [...userIds] }, year: previous.year, month: previous.month },
      select: { userId: true, points: true },
    }),
  ]);

  const group = (rows: { userId: string; points: number }[]) => {
    const map = new Map<string, number[]>();
    for (const row of rows) {
      const list = map.get(row.userId) ?? [];
      list.push(row.points);
      map.set(row.userId, list);
    }
    return map;
  };

  const current = group(thisMonth);
  const prior = group(lastMonth);

  const result = new Map<string, MemberScore>();

  for (const userId of userIds) {
    const points = current.get(userId) ?? [];
    const score = monthlyScore(points);
    const previousPoints = prior.get(userId);

    result.set(userId, {
      userId,
      score,
      band: scoreBand(score),
      // No events last month is not the same as no history — a member with a
      // clean month legitimately scored 100. Only a member who did not exist
      // in the data at all gets a null trend.
      trend: previousPoints === undefined ? null : score - monthlyScore(previousPoints),
      eventCount: points.length,
      deductions: points.filter((value) => value < 0).reduce((sum, value) => sum + value, 0),
      bonuses: points.filter((value) => value > 0).reduce((sum, value) => sum + value, 0),
    });
  }

  return result;
}

export type ScoreLedgerEntry = {
  id: string;
  /** Set once a dispute exists on this event. */
  disputeStatus: string | null;
  /** False once the dispute window has closed on it. */
  disputable: boolean;
  type: string;
  points: number;
  reason: string;
  createdAt: Date;
  milestoneId: string | null;
  milestoneTitle: string | null;
  projectTitle: string | null;
  clientName: string | null;
  createdByName: string | null;
};

/** One member's full ledger for a cycle, newest first. */
export async function ledgerFor(
  userId: string,
  cycle: Cycle,
): Promise<ScoreLedgerEntry[]> {
  const events = await prisma.scoreEvent.findMany({
    where: { userId, year: cycle.year, month: cycle.month },
    orderBy: { createdAt: "desc" },
    include: {
      createdBy: { select: { name: true } },
      dispute: { select: { status: true } },
      milestone: {
        select: {
          title: true,
          module: {
            select: {
              project: { select: { title: true, client: { select: { businessName: true } } } },
            },
          },
        },
      },
    },
  });

  const settings = await getSettings();
  const windowMs = settings.disputeWindowDays * 86_400_000;
  const now = Date.now();

  return events.map((event) => ({
    id: event.id,
    disputeStatus: event.dispute?.status ?? null,
    // Only charges, only inside the window, only if not already disputed.
    disputable:
      event.points < 0 &&
      !event.dispute &&
      now - event.createdAt.getTime() <= windowMs,
    type: event.type,
    points: event.points,
    reason: event.reason,
    createdAt: event.createdAt,
    milestoneId: event.milestoneId,
    milestoneTitle: event.milestone?.title ?? null,
    projectTitle: event.milestone?.module.project.title ?? null,
    clientName: event.milestone?.module.project.client.businessName ?? null,
    createdByName: event.createdBy?.name ?? null,
  }));
}

/**
 * Share of a member's work that was handed in by its deadline.
 *
 * Phase 8 moved this onto submission, for the same reason scoring moved: an
 * approval queue is the owner's speed, not the member's. It is also scoped to
 * the milestones **due** in the cycle rather than the ones approved in it, so
 * the rate answers "did this month's work land on time" instead of "how much
 * did the owner get round to signing off".
 *
 * The denominator counts only milestones whose deadline has passed or that
 * have already been submitted. Counting work due in three weeks as not-yet-
 * on-time would judge time that hasn't happened.
 */
export async function onTimeRateFor(
  userIds: readonly string[],
  cycle: Cycle,
  now: Date = new Date(),
): Promise<Map<string, { onTime: number; total: number; rate: number }>> {
  const context = await performanceContext(userIds, cycle, now);

  const result = new Map<string, { onTime: number; total: number; rate: number }>();
  for (const [userId, entry] of context) {
    result.set(userId, { onTime: entry.onTime, total: entry.judged, rate: entry.onTimeRate });
  }
  return result;
}

export type PerformanceContext = {
  userId: string;
  /** Milestones due in this cycle, whatever their state — the workload. */
  load: number;
  /** Sum of those milestones' weights, so 12 heavy tasks read differently. */
  totalWeight: number;
  /** Of the judged ones, how many were submitted by the effective deadline. */
  onTime: number;
  /** Milestones whose deadline has passed or that have been submitted. */
  judged: number;
  onTimeRate: number;
  /** How many are still blocked right now, for the "why" behind a low rate. */
  blocked: number;
};

/**
 * Volume context for a set of members in one cycle.
 *
 * The Fairness Doctrine forbids showing a raw score on its own: a 92 carrying
 * four milestones and a 92 carrying nineteen are not the same achievement.
 * Every surface that renders a score pairs it with this.
 */
export async function performanceContext(
  userIds: readonly string[],
  cycle: Cycle,
  now: Date = new Date(),
): Promise<Map<string, PerformanceContext>> {
  const result = new Map<string, PerformanceContext>();
  for (const userId of userIds) {
    result.set(userId, {
      userId,
      load: 0,
      totalWeight: 0,
      onTime: 0,
      judged: 0,
      onTimeRate: 0,
      blocked: 0,
    });
  }
  if (userIds.length === 0) return result;

  const due = await prisma.milestone.findMany({
    where: { assigneeId: { in: [...userIds] } },
    select: {
      assigneeId: true,
      dueDate: true,
      weight: true,
      status: true,
      submittedAt: true,
      blockedMinutes: true,
      blockedSince: true,
    },
  });

  for (const milestone of due) {
    if (!milestone.assigneeId) continue;

    const cycleOf = agencyYearMonth(milestone.dueDate);
    if (cycleOf.year !== cycle.year || cycleOf.month !== cycle.month) continue;

    const entry = result.get(milestone.assigneeId);
    if (!entry) continue;

    entry.load += 1;
    entry.totalWeight += milestone.weight;
    if (milestone.status === "BLOCKED") entry.blocked += 1;

    // The deadline this milestone is actually judged against, including any
    // block still running.
    const blockedMinutes =
      milestone.blockedMinutes +
      (milestone.blockedSince
        ? Math.max(0, Math.floor((now.getTime() - milestone.blockedSince.getTime()) / 60_000))
        : 0);
    const deadline = effectiveDeadline(dueDeadline(milestone.dueDate), blockedMinutes);

    if (milestone.submittedAt) {
      entry.judged += 1;
      if (milestone.submittedAt <= deadline) entry.onTime += 1;
    } else if (deadline < now) {
      // Past its deadline with nothing handed in: judged, and not on time.
      entry.judged += 1;
    }
  }

  for (const entry of result.values()) {
    entry.onTimeRate =
      entry.judged === 0 ? 0 : Math.round((entry.onTime / entry.judged) * 100);
  }

  return result;
}

export { MONTHLY_BASELINE };
