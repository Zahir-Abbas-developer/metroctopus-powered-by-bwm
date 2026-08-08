import { prisma } from "@/lib/prisma";
import {
  addDays,
  agencyYearMonth,
  dueDeadline,
  endOfAgencyMonth,
  endOfAgencyWeek,
  formatPeriod,
  previousYearMonth,
  startOfAgencyMonth,
  startOfAgencyWeek,
  toDateOnly,
} from "@/lib/date";
import { monthlyScore, scoreBand, type ScoreEventType } from "@/lib/scoring";
import { performanceContext } from "@/lib/score-service";
import { clientBlockedDays } from "@/lib/blocking";
import { businessDevelopmentSummary } from "@/lib/pipeline";
import { monthlyLoadFor } from "@/lib/capacity-service";
import { narrateClientReport, narrateMemberReport } from "@/lib/narrative";
import { notify } from "@/lib/notifications";
import {
  PAYLOAD_VERSION,
  reportDedupeKey,
  type ClientReportPayload,
  type MemberReportPayload,
  type ReportAttendance,
  type ReportPayload,
  type ReportType,
} from "@/lib/report-types";

// Re-exported so server callers can keep importing from one place.
export * from "@/lib/report-types";

/**
 * Report generation.
 *
 * A report is a statement about a period that has closed, so the payload is a
 * frozen snapshot: reopening a milestone in October must not rewrite what
 * August's report said. Everything the document renders comes out of that
 * snapshot — the pages never re-query the live tables.
 */

// ---------------------------------------------------------------------------
// Member reports
// ---------------------------------------------------------------------------

const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "SUBMITTED"];

async function buildMemberPayload(
  userId: string,
  periodStart: Date,
  periodEnd: Date,
  type: ReportType,
): Promise<MemberReportPayload | null> {
  const member = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, jobTitle: true, avatarColor: true },
  });
  if (!member) return null;

  const weekly = type === "MEMBER_WEEKLY";
  // The score cycle is monthly by definition, so a weekly report reports the
  // score of the cycle its week sits in — not a "weekly score", which would be
  // a different and undefined thing.
  const cycle = agencyYearMonth(periodEnd);
  const previousCycle = previousYearMonth(cycle);

  const rangeEnd = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);

  const [cycleEvents, previousEvents, periodEvents, completed, missed] = await Promise.all([
    prisma.scoreEvent.findMany({
      where: { userId, year: cycle.year, month: cycle.month },
      select: { points: true },
    }),
    prisma.scoreEvent.findMany({
      where: { userId, year: previousCycle.year, month: previousCycle.month },
      select: { points: true },
    }),
    prisma.scoreEvent.findMany({
      where: { userId, createdAt: { gte: periodStart, lt: rangeEnd } },
      orderBy: { createdAt: "desc" },
      include: {
        milestone: {
          select: {
            title: true,
            module: {
              select: {
                name: true,
                project: { select: { client: { select: { businessName: true } } } },
              },
            },
          },
        },
      },
    }),
    prisma.milestone.findMany({
      where: {
        assigneeId: userId,
        status: "COMPLETED",
        completedAt: { gte: periodStart, lt: rangeEnd },
      },
      select: {
        dueDate: true,
        completedAt: true,
        module: { select: { name: true } },
      },
    }),
    prisma.milestone.findMany({
      where: {
        assigneeId: userId,
        status: "MISSED",
        dueDate: { gte: periodStart, lt: rangeEnd },
      },
      select: { module: { select: { name: true } } },
    }),
  ]);

  const attendance = await buildAttendanceSummary(userId, periodStart, rangeEnd);

  const [capacity, bd] = await Promise.all([
    monthlyLoadFor(userId, periodStart, rangeEnd),
    businessDevelopmentSummary(userId, periodStart, rangeEnd),
  ]);

  // Volume context: the doctrine forbids a score without it, and the narrative
  // needs the team ranking to say "the heaviest load on the team".
  const teamIds = (
    await prisma.user.findMany({
      where: { role: "MEMBER", isActive: true },
      select: { id: true },
    })
  ).map((row) => row.id);

  const teamContext = await performanceContext(
    teamIds.includes(userId) ? teamIds : [...teamIds, userId],
    cycle,
    periodEnd,
  );
  const own = teamContext.get(userId);
  const ranked = [...teamContext.values()].sort((a, b) => b.load - a.load);
  const rank = own && own.load > 0 ? ranked.findIndex((row) => row.userId === userId) + 1 : null;

  const score = monthlyScore(cycleEvents.map((event) => event.points));
  const previousScore =
    previousEvents.length === 0 && cycleEvents.length === 0
      ? null
      : monthlyScore(previousEvents.map((event) => event.points));

  const onTime = completed.filter(
    (milestone) => milestone.completedAt! <= dueDeadline(milestone.dueDate),
  ).length;

  const lateCount = periodEvents.filter((event) => event.type === "LATE").length;
  const rejectedCount = periodEvents.filter((event) => event.type === "REJECTED").length;

  const gained = periodEvents
    .filter((event) => event.points > 0)
    .reduce((sum, event) => sum + event.points, 0);
  const lost = periodEvents
    .filter((event) => event.points < 0)
    .reduce((sum, event) => sum + event.points, 0);

  // Where the trouble was concentrated, for the narrative's last sentence.
  const troubleArea = mostCommon(
    periodEvents
      .filter((event) => event.points < 0)
      .map((event) => event.milestone?.module.name)
      .filter((name): name is string => Boolean(name)),
  );

  const band = scoreBand(score);
  const narrativeFacts = {
    firstName: member.name.split(" ")[0],
    periodPhrase: weekly ? "this week" : "this month",
    previousPhrase: weekly ? "last week" : "last month",
    completedTotal: completed.length,
    completedOnTime: onTime,
    lateCount,
    missedCount: missed.length,
    rejectedCount,
    score,
    delta: previousScore === null ? null : round(score - previousScore),
    troubleArea,
    load: {
      count: own?.load ?? 0,
      rank,
      teamSize: teamIds.length,
    },
    attendance: {
      checksPassed: attendance.checksPassed,
      checksTotal: attendance.checksTotal,
      daysAbsent: attendance.daysAbsent,
      daysLate: attendance.daysLate,
    },
  };

  return {
    version: PAYLOAD_VERSION,
    kind: "MEMBER",
    member,
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label: formatPeriod(periodStart, periodEnd),
      phrase: weekly ? "week" : "month",
    },
    score: {
      value: score,
      bandKey: band.key,
      bandLabel: band.label,
      bandColor: band.color,
      previous: previousScore,
      delta: previousScore === null ? null : round(score - previousScore),
    },
    points: { gained: round(gained), lost: round(lost), net: round(gained + lost) },
    events: periodEvents.map((event) => ({
      id: event.id,
      type: event.type as ScoreEventType,
      points: event.points,
      reason: event.reason,
      at: event.createdAt.toISOString(),
      milestoneTitle: event.milestone?.title ?? null,
      clientName: event.milestone?.module.project.client.businessName ?? null,
    })),
    milestones: {
      completed: completed.length,
      onTime,
      late: lateCount,
      missed: missed.length,
      rejected: rejectedCount,
    },
    // On the submission basis, and over what was due rather than what was
    // approved — the same figure the badges and profiles show.
    onTimeRate: own?.onTimeRate ?? 0,
    load: { count: own?.load ?? 0, weight: own?.totalWeight ?? 0, rank },
    capacity,
    // Only for people who actually work a pipeline. A delivery member's report
    // has no business-development section rather than an empty one.
    businessDevelopment: bd.active
      ? {
          activities: bd.activities,
          byBucket: bd.byBucket,
          leadsWorked: bd.leadsWorked,
          stageConversion: bd.stageConversion,
          dealsWon: bd.dealsWon,
          dealsLost: bd.dealsLost,
          revenueAdded: bd.revenueAdded,
        }
      : undefined,
    attendance,
    narrative: {
      second: narrateMemberReport(narrativeFacts, "second"),
      third: narrateMemberReport(narrativeFacts, "third"),
    },
  };
}

/**
 * The attendance half of a member report.
 *
 * Reads only — the report states what the ledger and the attendance tables
 * already say. Checks are counted by the day they belong to, so a check that
 * fired at 9 PM on the last day of the period is inside it.
 */
async function buildAttendanceSummary(
  userId: string,
  periodStart: Date,
  rangeEnd: Date,
): Promise<ReportAttendance> {
  const days = await prisma.attendanceDay.findMany({
    where: { userId, date: { gte: periodStart, lt: rangeEnd } },
    select: {
      status: true,
      totalMinutes: true,
      checks: { select: { status: true, scheduledAt: true, respondedAt: true } },
    },
  });

  const checks = days.flatMap((day) => day.checks);
  const answered = checks.filter(
    (check) => check.status === "PASSED" && check.respondedAt !== null,
  );

  // "Total" excludes cancelled checks: a check that was withdrawn when someone
  // clocked out was never put to them, so counting it would depress the ratio
  // for something that never happened.
  const counted = checks.filter((check) => check.status !== "CANCELLED");

  const responseSeconds = answered.map((check) =>
    Math.max(0, Math.round((check.respondedAt!.getTime() - check.scheduledAt.getTime()) / 1000)),
  );

  return {
    daysPresent: days.filter((day) => day.status === "PRESENT" || day.status === "LATE").length,
    daysLate: days.filter((day) => day.status === "LATE").length,
    daysAbsent: days.filter((day) => day.status === "ABSENT").length,
    daysOnLeave: days.filter((day) => day.status === "LEAVE").length,
    checksPassed: checks.filter((check) => check.status === "PASSED").length,
    checksTotal: counted.length,
    avgResponseSeconds:
      responseSeconds.length === 0
        ? null
        : Math.round(
            responseSeconds.reduce((sum, value) => sum + value, 0) / responseSeconds.length,
          ),
    minutesWorked: days.reduce((sum, day) => sum + (day.totalMinutes ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Client reports
// ---------------------------------------------------------------------------

async function buildClientPayload(
  clientId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<ClientReportPayload | null> {
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, businessName: true, industry: true },
  });
  if (!client) return null;

  const rangeEnd = new Date(periodEnd.getTime() + 24 * 60 * 60 * 1000);
  const nextPeriodEnd = addDays(rangeEnd, 7);

  // The engagement that covers this week, else the most recent one.
  const project =
    (await prisma.project.findFirst({
      where: { clientId, startDate: { lte: periodEnd }, endDate: { gte: periodStart } },
      orderBy: { startDate: "desc" },
    })) ??
    (await prisma.project.findFirst({ where: { clientId }, orderBy: { startDate: "desc" } }));

  if (!project) {
    return {
      version: PAYLOAD_VERSION,
      kind: "CLIENT",
      client: { id: client.id, name: client.businessName, industry: client.industry },
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString(),
        label: formatPeriod(periodStart, periodEnd),
      },
      project: null,
      awaitingInput: { totalDays: 0, items: [] },
      completedThisPeriod: [],
      plannedNextPeriod: [],
      overdue: [],
      narrative: narrateClientReport({
        clientName: client.businessName,
        projectTitle: null,
        completedThisPeriod: 0,
        completionPercent: 0,
        plannedNext: 0,
        overdueCount: 0,
      }),
    };
  }

  const milestones = await prisma.milestone.findMany({
    where: { module: { projectId: project.id } },
    include: {
      module: { select: { name: true } },
      assignee: { select: { name: true } },
    },
    orderBy: [{ dueDate: "asc" }],
  });

  const done = milestones.filter((m) => m.status === "COMPLETED").length;
  const completionPercent =
    milestones.length === 0 ? 0 : Math.round((done / milestones.length) * 100);

  const completedThisPeriod = milestones
    .filter(
      (m) =>
        m.status === "COMPLETED" &&
        m.completedAt &&
        m.completedAt >= periodStart &&
        m.completedAt < rangeEnd,
    )
    .map((m) => ({
      module: m.module.name,
      title: m.title,
      completedAt: m.completedAt!.toISOString(),
      assignee: m.assignee?.name ?? null,
    }));

  const plannedNextPeriod = milestones
    .filter(
      (m) =>
        OPEN_STATUSES.includes(m.status) &&
        m.dueDate >= rangeEnd &&
        m.dueDate < nextPeriodEnd,
    )
    .map((m) => ({
      module: m.module.name,
      title: m.title,
      dueDate: m.dueDate.toISOString(),
      assignee: m.assignee?.name ?? null,
    }));

  const overdue = milestones
    .filter((m) => m.status !== "COMPLETED" && dueDeadline(m.dueDate) < rangeEnd)
    .map((m) => ({
      module: m.module.name,
      title: m.title,
      dueDate: m.dueDate.toISOString(),
      assignee: m.assignee?.name ?? null,
      daysLate: Math.max(
        0,
        Math.floor((rangeEnd.getTime() - dueDeadline(m.dueDate).getTime()) / 86_400_000),
      ),
    }));

  // What we are waiting on them for. Stated as a fact with a number, not a
  // complaint — the point is that "this slipped" and "we asked you on the 4th"
  // stop being two competing recollections.
  const waiting = await clientBlockedDays(client.id);

  return {
    version: PAYLOAD_VERSION,
    kind: "CLIENT",
    client: { id: client.id, name: client.businessName, industry: client.industry },
    period: {
      start: periodStart.toISOString(),
      end: periodEnd.toISOString(),
      label: formatPeriod(periodStart, periodEnd),
    },
    awaitingInput: {
      totalDays: waiting.totalDays,
      items: waiting.openItems.map((item) => ({
        title: item.title,
        since: item.since.toISOString(),
        note: item.note,
        days: Math.round((item.minutes / (60 * 24)) * 10) / 10,
      })),
    },
    project: {
      id: project.id,
      title: project.title,
      startDate: project.startDate.toISOString(),
      endDate: project.endDate.toISOString(),
      completionPercent,
      total: milestones.length,
      done,
    },
    completedThisPeriod,
    plannedNextPeriod,
    overdue,
    narrative: narrateClientReport({
      clientName: client.businessName,
      projectTitle: project.title,
      completedThisPeriod: completedThisPeriod.length,
      completionPercent,
      plannedNext: plannedNextPeriod.length,
      overdueCount: overdue.length,
    }),
  };
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export type GenerationResult = {
  memberWeekly: number;
  memberMonthly: number;
  clientWeekly: number;
  skipped: number;
  periods: { weekly: string; monthly: string };
};

/**
 * Generate a batch of reports for the periods containing `reference`.
 *
 * Idempotent: the unique `dedupeKey` means a second run for the same period
 * updates nothing and creates nothing. `regenerate` is the deliberate escape
 * hatch for when a period's data was corrected after the fact.
 */
export async function generateReports(options: {
  types: readonly ReportType[];
  reference?: Date;
  regenerate?: boolean;
  /** Off for seeding, so a demo agency doesn't email invented people. */
  sendEmails?: boolean;
}): Promise<GenerationResult> {
  const reference = options.reference ?? new Date();
  const weekStart = startOfAgencyWeek(reference);
  const weekEnd = endOfAgencyWeek(reference);
  const monthStart = startOfAgencyMonth(reference);
  const monthEnd = endOfAgencyMonth(reference);

  const result: GenerationResult = {
    memberWeekly: 0,
    memberMonthly: 0,
    clientWeekly: 0,
    skipped: 0,
    periods: {
      weekly: formatPeriod(weekStart, weekEnd),
      monthly: formatPeriod(monthStart, monthEnd),
    },
  };

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true },
  });

  for (const type of options.types) {
    if (type === "MEMBER_WEEKLY" || type === "MEMBER_MONTHLY") {
      const [start, end] =
        type === "MEMBER_WEEKLY" ? [weekStart, weekEnd] : [monthStart, monthEnd];

      for (const member of members) {
        const payload = await buildMemberPayload(member.id, start, end, type);
        if (!payload) continue;

        const saved = await save({
          type,
          periodStart: start,
          periodEnd: end,
          userId: member.id,
          clientId: null,
          payload,
          regenerate: options.regenerate,
        });

        if (saved.created) {
          result[type === "MEMBER_WEEKLY" ? "memberWeekly" : "memberMonthly"] += 1;
          await notify({
            userId: member.id,
            type: "REPORT_READY",
            title: `Your ${type === "MEMBER_WEEKLY" ? "weekly" : "monthly"} report is ready`,
            body: payload.narrative.second,
            href: `/reports/${saved.id}`,
            reportId: saved.id,
            dedupeKey: `report:${saved.id}`,
          });

          // Only on first generation — a regeneration is a correction, not
          // news worth mailing about again.
          if (options.sendEmails !== false) {
            const { sendReportReady } = await import("@/lib/email/dispatch");
            await sendReportReady(saved.id);
          }
        } else {
          result.skipped += 1;
        }
      }
      continue;
    }

    // CLIENT_WEEKLY — only for clients actually being worked on.
    const clients = await prisma.client.findMany({
      where: { status: { in: ["ACTIVE", "PAUSED"] } },
      select: { id: true },
    });

    for (const client of clients) {
      const payload = await buildClientPayload(client.id, weekStart, weekEnd);
      if (!payload) continue;

      const saved = await save({
        type,
        periodStart: weekStart,
        periodEnd: weekEnd,
        userId: null,
        clientId: client.id,
        payload,
        regenerate: options.regenerate,
      });

      if (saved.created) result.clientWeekly += 1;
      else result.skipped += 1;
    }
  }

  return result;
}

async function save(input: {
  type: ReportType;
  periodStart: Date;
  periodEnd: Date;
  userId: string | null;
  clientId: string | null;
  payload: ReportPayload;
  regenerate?: boolean;
}): Promise<{ id: string; created: boolean }> {
  const subjectId = input.userId ?? input.clientId ?? "agency";
  const dedupeKey = reportDedupeKey(input.type, input.periodStart, subjectId);

  const existing = await prisma.report.findUnique({ where: { dedupeKey } });

  if (existing && !input.regenerate) {
    return { id: existing.id, created: false };
  }

  if (existing) {
    const updated = await prisma.report.update({
      where: { dedupeKey },
      data: { payload: JSON.stringify(input.payload), generatedAt: new Date() },
    });
    return { id: updated.id, created: false };
  }

  const created = await prisma.report.create({
    data: {
      type: input.type,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      userId: input.userId,
      clientId: input.clientId,
      payload: JSON.stringify(input.payload),
      dedupeKey,
    },
  });

  return { id: created.id, created: true };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;

  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);

  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}
