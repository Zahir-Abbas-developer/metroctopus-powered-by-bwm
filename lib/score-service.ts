import { prisma } from "@/lib/prisma";
import { agencyYearMonth, dueDeadline, previousYearMonth } from "@/lib/date";
import {
  MONTHLY_BASELINE,
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

  return events.map((event) => ({
    id: event.id,
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
 * Share of a member's approved milestones that landed by their deadline.
 * Counted over completions in the cycle, not over everything assigned.
 */
export async function onTimeRateFor(
  userIds: readonly string[],
  cycle: Cycle,
): Promise<Map<string, { onTime: number; total: number; rate: number }>> {
  const completed = await prisma.milestone.findMany({
    where: {
      assigneeId: { in: [...userIds] },
      status: "COMPLETED",
      completedAt: { not: null },
    },
    select: { assigneeId: true, dueDate: true, completedAt: true },
  });

  const result = new Map<string, { onTime: number; total: number; rate: number }>();
  for (const userId of userIds) result.set(userId, { onTime: 0, total: 0, rate: 0 });

  for (const milestone of completed) {
    if (!milestone.assigneeId || !milestone.completedAt) continue;
    const cycleOf = agencyYearMonth(milestone.completedAt);
    if (cycleOf.year !== cycle.year || cycleOf.month !== cycle.month) continue;

    const entry = result.get(milestone.assigneeId);
    if (!entry) continue;

    entry.total += 1;
    if (milestone.completedAt <= dueDeadline(milestone.dueDate)) entry.onTime += 1;
  }

  for (const entry of result.values()) {
    entry.rate = entry.total === 0 ? 0 : Math.round((entry.onTime / entry.total) * 100);
  }

  return result;
}

export { MONTHLY_BASELINE };
