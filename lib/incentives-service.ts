import { prisma } from "@/lib/prisma";
import { agencyYearMonth, previousYearMonth } from "@/lib/date";
import type { Cycle } from "@/lib/score-service";
import { monthlyScore } from "@/lib/scoring";
import { notify } from "@/lib/notifications";
import { getSettings, incentiveConfigFrom } from "@/lib/settings";
import {
  excellenceStreak,
  performanceReview,
  type MonthScore,
  type StreakState,
} from "@/lib/incentives";

/**
 * The database side of the incentive engine.
 *
 * All the judgement is in lib/incentives.ts. This gathers months, writes
 * awards, and tells people.
 *
 * Awards are keyed `(user, type, year, month)`, so re-running a month close is
 * a no-op rather than a second bonus — the same guarantee every other
 * evaluation in this codebase makes with a unique index.
 */

/** A member's monthly scores, oldest first, over the last `count` cycles. */
export async function monthlyScores(
  userId: string,
  upTo: Cycle,
  count = 6,
): Promise<MonthScore[]> {
  const cycles: Cycle[] = [];
  let cursor = upTo;
  for (let index = 0; index < count; index += 1) {
    cycles.unshift(cursor);
    cursor = previousYearMonth(cursor);
  }

  const from = new Date(Date.UTC(cycles[0].year, cycles[0].month - 1, 1));
  const to = new Date(
    Date.UTC(cycles[cycles.length - 1].year, cycles[cycles.length - 1].month, 1),
  );

  const [events, member, attendance, milestones] = await Promise.all([
    prisma.scoreEvent.findMany({
      where: { userId },
      select: { points: true, year: true, month: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
    // Evidence the member actually worked the month.
    prisma.attendanceDay.findMany({
      where: { userId, date: { gte: from, lt: to }, status: { in: ["PRESENT", "LATE"] } },
      select: { date: true },
    }),
    prisma.milestone.findMany({
      where: { assigneeId: userId, dueDate: { gte: from, lt: to } },
      select: { dueDate: true },
    }),
  ]);

  const joined = member?.createdAt ?? new Date(0);

  const worked = new Set<string>();
  for (const day of attendance) worked.add(monthKey(day.date));
  for (const milestone of milestones) worked.add(monthKey(milestone.dueDate));

  return cycles.map((cycle) => {
    const own = events.filter(
      (event) => event.year === cycle.year && event.month === cycle.month,
    );

    /**
     * A month only counts if there is evidence the member worked it.
     *
     * A score is `100 + sum(events)`, so a month with **no events at all**
     * scores a perfect 100 — which is right for someone who had a clean month
     * and completely wrong for a month nobody was here. Counting the empty
     * ones would hand every member of a brand-new agency an excellence bonus
     * after three months of an empty database, and would let somebody on
     * extended leave accrue a streak for doing nothing.
     *
     * Evidence is: score events, days worked, or milestones that came due.
     */
    const key = `${cycle.year}-${cycle.month}`;
    const monthEnd = new Date(Date.UTC(cycle.year, cycle.month, 1));
    const active = joined < monthEnd && (own.length > 0 || worked.has(key));

    return {
      year: cycle.year,
      month: cycle.month,
      score: monthlyScore(own.map((event) => event.points)),
      active,
    };
  });
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${date.getUTCMonth() + 1}`;
}

/** A member's live streak, for their own dashboard. */
export async function streakFor(userId: string, now = new Date()): Promise<StreakState> {
  const settings = await getSettings();
  const cycle = agencyYearMonth(now);
  const months = await monthlyScores(userId, cycle, settings.bonusStreakMonths + 3);

  return excellenceStreak(months, incentiveConfigFrom(settings));
}

export type IncentiveRun = {
  cycle: Cycle;
  bonuses: { userId: string; name: string; streakMonths: number }[];
  reviews: { userId: string; name: string; lowMonths: number }[];
};

/**
 * The month-close pass.
 *
 * Runs against the month that has just **finished**, not the one starting, so
 * a run on the 1st settles what actually happened rather than a month with one
 * day in it.
 *
 * Evidence is frozen into the award at the moment it is raised — the score
 * events, the attendance summary, the disputes. A performance review that
 * pulls its evidence live would show different numbers by the time the
 * conversation happened, which is exactly the argument it exists to avoid.
 */
export async function runIncentives(now = new Date()): Promise<IncentiveRun> {
  const settings = await getSettings();
  const config = incentiveConfigFrom(settings);

  // The month that just closed.
  const cycle = previousYearMonth(agencyYearMonth(now));

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true, name: true },
  });

  const bonuses: IncentiveRun["bonuses"] = [];
  const reviews: IncentiveRun["reviews"] = [];

  for (const member of members) {
    const months = await monthlyScores(member.id, cycle, config.reviewWindowMonths + 4);
    const streak = excellenceStreak(months, config);
    const review = performanceReview(months, config);

    if (streak.earned) {
      const created = await award({
        userId: member.id,
        type: "EXCELLENCE_STREAK",
        cycle,
        streakMonths: streak.months,
        evidence: await evidenceBundle(member.id, cycle, months),
        bonusPercent: settings.defaultBonusPercent,
      });

      if (created) {
        bonuses.push({ userId: member.id, name: member.name, streakMonths: streak.months });

        await notify({
          userId: member.id,
          type: "WORK_APPROVED",
          title: "Excellence bonus earned",
          body: `${streak.months} months at ${config.bonusThresholdScore}+. The owner has been told.`,
          href: "/my-performance",
          dedupeKey: `bonus:${member.id}:${cycle.year}-${cycle.month}`,
        });
      }
    }

    if (review.triggered) {
      const created = await award({
        userId: member.id,
        type: "PERFORMANCE_REVIEW",
        cycle,
        streakMonths: review.lowMonths,
        evidence: await evidenceBundle(member.id, cycle, months),
      });

      if (created) {
        reviews.push({ userId: member.id, name: member.name, lowMonths: review.lowMonths });
        // Deliberately not notified to the member here. A review is a
        // conversation the owner should open in person, not something someone
        // finds out from a push notification at 2am.
      }
    }
  }

  for (const admin of await admins()) {
    if (bonuses.length === 0 && reviews.length === 0) continue;

    await notify({
      userId: admin.id,
      type: "REPORT_READY",
      title: "Month closed — incentives evaluated",
      body: [
        bonuses.length > 0
          ? `${bonuses.length} bonus-eligible: ${bonuses.map((row) => row.name).join(", ")}.`
          : "",
        reviews.length > 0
          ? `${reviews.length} performance review${reviews.length === 1 ? "" : "s"} raised.`
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      href: "/incentives",
      dedupeKey: `incentives:${cycle.year}-${cycle.month}:${admin.id}`,
    });
  }

  return { cycle, bonuses, reviews };
}

async function award(input: {
  userId: string;
  type: "EXCELLENCE_STREAK" | "PERFORMANCE_REVIEW";
  cycle: Cycle;
  streakMonths: number;
  evidence: unknown;
  bonusPercent?: number;
}): Promise<boolean> {
  try {
    await prisma.incentiveAward.create({
      data: {
        userId: input.userId,
        type: input.type,
        year: input.cycle.year,
        month: input.cycle.month,
        streakMonths: input.streakMonths,
        evidence: JSON.stringify(input.evidence),
        bonusPercent: input.bonusPercent ?? null,
      },
    });
    return true;
  } catch {
    // Already awarded for this month. The unique index is the guard.
    return false;
  }
}

/**
 * Everything behind the decision, frozen.
 *
 * A review conversation two weeks later must be about the same numbers that
 * raised it. Re-querying at read time would quietly change the case.
 */
async function evidenceBundle(userId: string, cycle: Cycle, months: MonthScore[]) {
  const [events, attendance, disputes] = await Promise.all([
    prisma.scoreEvent.findMany({
      where: { userId, year: cycle.year, month: cycle.month },
      orderBy: { createdAt: "desc" },
      select: { type: true, points: true, reason: true, createdAt: true },
    }),
    prisma.attendanceDay.findMany({
      where: {
        userId,
        date: {
          gte: new Date(Date.UTC(cycle.year, cycle.month - 1, 1)),
          lt: new Date(Date.UTC(cycle.year, cycle.month, 1)),
        },
      },
      select: { status: true },
    }),
    prisma.dispute.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { status: true, reason: true, createdAt: true, responseNote: true },
    }),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    months: months.map((month) => ({
      year: month.year,
      month: month.month,
      score: month.score,
      active: month.active,
    })),
    events: events.map((event) => ({
      type: event.type,
      points: event.points,
      reason: event.reason,
      at: event.createdAt.toISOString(),
    })),
    attendance: {
      present: attendance.filter((day) => day.status === "PRESENT").length,
      late: attendance.filter((day) => day.status === "LATE").length,
      absent: attendance.filter((day) => day.status === "ABSENT").length,
    },
    disputes: disputes.map((dispute) => ({
      status: dispute.status,
      reason: dispute.reason,
      response: dispute.responseNote,
      at: dispute.createdAt.toISOString(),
    })),
  };
}

/** Open incentive items for the owner: the bonus list and the review flags. */
export async function incentiveQueue() {
  const awards = await prisma.incentiveAward.findMany({
    orderBy: [{ actionedAt: "asc" }, { createdAt: "desc" }],
    take: 50,
    include: { user: { select: { id: true, name: true, avatarColor: true, jobTitle: true } } },
  });

  return awards.map((row) => ({
    id: row.id,
    type: row.type,
    year: row.year,
    month: row.month,
    streakMonths: row.streakMonths,
    bonusAmount: row.bonusAmount,
    bonusPercent: row.bonusPercent,
    actionedAt: row.actionedAt?.toISOString() ?? null,
    actionedNote: row.actionedNote,
    createdAt: row.createdAt.toISOString(),
    member: row.user,
    evidence: JSON.parse(row.evidence) as Record<string, unknown>,
  }));
}

async function admins() {
  return prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
}
