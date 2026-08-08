import { prisma } from "@/lib/prisma";
import { applyEvents } from "@/lib/score-service";
import { attendanceDeduction } from "@/lib/scoring";
import { notify } from "@/lib/notifications";
import { sendCheckAlert } from "@/lib/reach";
import { getSettings, effectiveCheckLatest, type AgencySettings } from "@/lib/settings";
import { planChecksForDay } from "@/lib/attendance-schedule";
import {
  breakAllowance,
  breakMinutesUsed,
  overlaps,
  shiftCheckAfterBreak,
} from "@/lib/fairness-windows";
import {
  formatKarachiClock,
  formatKarachiRange,
  formatKarachiTime,
  karachiDay,
  karachiInstant,
  karachiMinutes,
  karachiWeekday,
  minutesBetween,
} from "@/lib/attendance-time";

/**
 * The attendance service: everything that writes.
 *
 * Two properties hold throughout, because attendance touches people's scores:
 *
 *   Idempotent — every score event carries a unique dedupe key derived from
 *   what it is about (`check:<id>:MISS`, `day:<id>:ABSENT`). A check can never
 *   charge twice, however many times the expiry path runs.
 *
 *   Lazy but safe — a serverless app has nothing running at 4:12 PM to fire a
 *   check. Instead, any read of attendance state settles whatever is now due:
 *   the member's own 60-second poll does it, and the daily job is the backstop
 *   for a member who never opens the app. The result is identical either way
 *   because the transition depends on the clock, not on who asked.
 */

export type DayStatus = "PRESENT" | "LATE" | "ABSENT" | "LEAVE" | "OFF";

const OPEN_CHECK_STATUSES = ["SCHEDULED", "ACTIVE"];

// ---------------------------------------------------------------------------
// Reading the shape of a day
// ---------------------------------------------------------------------------

/** Whether a given Karachi day is workable at all, and why not if it isn't. */
export async function dayKind(
  userId: string,
  day: Date,
  settings: AgencySettings,
): Promise<{ kind: "WORKDAY" } | { kind: "OFF" } | { kind: "LEAVE"; reason: string }> {
  if (!settings.workdays.includes(karachiWeekday(day))) return { kind: "OFF" };

  const leave = await prisma.leaveRequest.findUnique({
    where: { userId_date: { userId, date: karachiDay(day) } },
  });

  if (leave?.status === "APPROVED") return { kind: "LEAVE", reason: leave.reason };

  return { kind: "WORKDAY" };
}

// ---------------------------------------------------------------------------
// Clock in
// ---------------------------------------------------------------------------

export type ClockInResult =
  | { ok: true; dayId: string; status: DayStatus; late: boolean; checksCreated: number }
  | { ok: false; reason: string };

/**
 * Starts a member's day and, in the same breath, generates the hidden checks.
 *
 * Generation happens here and nowhere else: the times exist only server-side,
 * created from a cryptographic source at the one moment the member cannot be
 * observing the scheduler.
 */
export async function clockIn(userId: string, now = new Date()): Promise<ClockInResult> {
  const settings = await getSettings();
  const day = karachiDay(now);
  const minutes = karachiMinutes(now);

  const kind = await dayKind(userId, now, settings);
  if (kind.kind === "OFF") {
    return { ok: false, reason: "Today isn't a working day." };
  }
  if (kind.kind === "LEAVE") {
    return { ok: false, reason: "You're on approved leave today." };
  }

  if (minutes < settings.clockInOpensMinutes) {
    return {
      ok: false,
      reason: `Clock-in opens at ${formatKarachiClock(settings.clockInOpensMinutes)}.`,
    };
  }

  // Past the absent cutoff the day is already lost, and letting someone start
  // then would produce a day that is both ABSENT and PRESENT. The owner can
  // excuse the absence instead, which keeps the audit trail honest.
  if (minutes >= settings.absentCutoffMinutes) {
    return {
      ok: false,
      reason: `Clock-in closed at ${formatKarachiClock(settings.absentCutoffMinutes)}. Ask the owner to excuse today.`,
    };
  }

  const existing = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: day } },
  });

  if (existing?.clockInAt) {
    return { ok: false, reason: "You've already started your day." };
  }

  const late = minutes > settings.shiftStartMinutes + settings.graceMinutes;
  const status: DayStatus = late ? "LATE" : "PRESENT";

  const record = await prisma.attendanceDay.upsert({
    where: { userId_date: { userId, date: day } },
    update: { clockInAt: now, status, autoClosed: false },
    create: { userId, date: day, clockInAt: now, status },
  });

  // The hidden schedule.
  const planned = planChecksForDay({
    day: now,
    clockInAt: now,
    windowMinutes: settings.checkWindowMinutes,
    config: {
      count: settings.checksPerDay,
      earliestMinutes: minutes + settings.checkEarliestOffsetMinutes,
      latestMinutes: effectiveCheckLatest(settings),
      minGapMinutes: settings.checkMinGapMinutes,
    },
  });

  if (planned.length > 0) {
    await prisma.availabilityCheck.createMany({
      data: planned.map((check) => ({
        attendanceDayId: record.id,
        scheduledAt: check.scheduledAt,
        windowEndsAt: check.windowEndsAt,
        status: "SCHEDULED",
      })),
    });
  }

  if (late) {
    await applyEvents(
      [
        {
          userId,
          milestoneId: null,
          type: "LATE_CLOCK_IN",
          points: attendanceDeduction(settings.penaltyLateClockIn),
          reason: `Clocked in at ${formatKarachiTime(now)}, after the ${formatKarachiClock(
            settings.shiftStartMinutes + settings.graceMinutes,
          )} grace period.`,
          dedupeKey: `day:${record.id}:LATE_CLOCK_IN`,
        },
      ],
      { at: now },
    );
  }

  return {
    ok: true,
    dayId: record.id,
    status,
    late,
    checksCreated: planned.length,
  };
}

// ---------------------------------------------------------------------------
// Clock out
// ---------------------------------------------------------------------------

export type ClockOutResult =
  | { ok: true; totalMinutes: number; cancelledChecks: number }
  | { ok: false; reason: string };

export async function clockOut(userId: string, now = new Date()): Promise<ClockOutResult> {
  const day = karachiDay(now);

  const record = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: day } },
    include: { checks: true },
  });

  if (!record?.clockInAt) return { ok: false, reason: "You haven't started your day yet." };
  if (record.clockOutAt) return { ok: false, reason: "You've already ended your day." };

  const totalMinutes = minutesBetween(record.clockInAt, now);

  // Checks that never triggered are cancelled, not missed. Leaving early is
  // visible to the owner on the board; it is not a reason to charge someone
  // for a check that was never put to them.
  const cancelled = await prisma.availabilityCheck.updateMany({
    where: { attendanceDayId: record.id, status: "SCHEDULED" },
    data: { status: "CANCELLED" },
  });

  await prisma.attendanceDay.update({
    where: { id: record.id },
    data: { clockOutAt: now, totalMinutes },
  });

  return { ok: true, totalMinutes, cancelledChecks: cancelled.count };
}

// ---------------------------------------------------------------------------
// Check lifecycle
// ---------------------------------------------------------------------------

export type SettleResult = {
  activated: number;
  missed: number;
  pointsCharged: number;
  /** Held for the owner's judgement because a declared outage covers them. */
  underReview: number;
  /** Left alone because the member is on a protected break right now. */
  heldForBreak: number;
};

/**
 * Moves every check that is now due into its next state.
 *
 * Called on every attendance read and by the daily job. Scoped to one member
 * when a member triggers it, and to everyone when the job does.
 *
 * Phase 8 added two ways a check can avoid becoming a MISS, both of them
 * fairness rules rather than escape hatches:
 *
 *   A **declared outage** covering the window sends the check to
 *   PENDING_REVIEW instead of MISSED — no charge until the owner decides.
 *
 *   An **open break** freezes the member's checks entirely. Nothing activates
 *   and, critically, nothing expires, so protected time can never cost points.
 *   The checks are shifted when the break ends; see `endBreak`.
 */
export async function settleChecks(
  options: { userId?: string; now?: Date } = {},
): Promise<SettleResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  const due = await prisma.availabilityCheck.findMany({
    where: {
      status: { in: OPEN_CHECK_STATUSES },
      scheduledAt: { lte: now },
      ...(options.userId ? { day: { userId: options.userId } } : {}),
    },
    include: { day: { select: { id: true, userId: true } } },
  });

  let activated = 0;
  let missed = 0;
  let pointsCharged = 0;
  let underReview = 0;
  let heldForBreak = 0;

  // Who is on a break right now, and which outages are live — fetched once for
  // the whole batch rather than per check, because the daily sweep runs this
  // across every member at once.
  const userIds = [...new Set(due.map((check) => check.day.userId))];
  const [openBreaks, coveringOutages] = await Promise.all([
    userIds.length
      ? prisma.breakSession.findMany({
          where: { userId: { in: userIds }, endedAt: null },
          select: { userId: true },
        })
      : Promise.resolve([]),
    userIds.length
      ? prisma.outageReport.findMany({
          where: { userId: { in: userIds }, status: { in: ["PENDING", "APPROVED"] } },
          select: { id: true, userId: true, startsAt: true, endsAt: true },
        })
      : Promise.resolve([]),
  ]);

  const onBreak = new Set(openBreaks.map((session) => session.userId));

  for (const check of due) {
    // Protected time. Frozen in place — not activated, not expired.
    if (onBreak.has(check.day.userId)) {
      heldForBreak += 1;
      continue;
    }

    // Past its window and unanswered.
    if (check.windowEndsAt <= now) {
      if (check.status === "MISSED") continue;

      // A declared outage over the window means the member could not have
      // answered. The owner decides; nothing is charged in the meantime.
      const outage = coveringOutages.find(
        (report) =>
          report.userId === check.day.userId &&
          overlaps(
            { start: check.scheduledAt, end: check.windowEndsAt },
            { start: report.startsAt, end: report.endsAt },
          ),
      );

      if (outage) {
        await prisma.availabilityCheck.update({
          where: { id: check.id },
          data: { status: "PENDING_REVIEW", outageReportId: outage.id },
        });
        underReview += 1;
        continue;
      }

      await prisma.availabilityCheck.update({
        where: { id: check.id },
        data: { status: "MISSED" },
      });
      missed += 1;

      // The dedupe key is what makes this safe to run repeatedly: the same
      // check can never produce a second charge.
      const applied = await applyEvents(
        [
          {
            userId: check.day.userId,
            milestoneId: null,
            type: "ATTENDANCE_MISS",
            points: attendanceDeduction(settings.penaltyMissedCheck),
            reason: `Missed availability check (${formatKarachiRange(
              check.scheduledAt,
              check.windowEndsAt,
            )}).`,
            dedupeKey: `check:${check.id}:MISS`,
          },
        ],
        { at: check.windowEndsAt },
      );
      pointsCharged += applied;
      continue;
    }

    // Inside its window: make it live, and tell the member once.
    if (check.status === "SCHEDULED") {
      await prisma.availabilityCheck.update({
        where: { id: check.id },
        data: { status: "ACTIVE" },
      });
      activated += 1;

      await notify({
        userId: check.day.userId,
        type: "AVAILABILITY_CHECK",
        title: "Availability check",
        body: `Confirm you're at work — you have until ${formatKarachiTime(check.windowEndsAt)}.`,
        href: "/my-attendance",
        dedupeKey: `check:${check.id}:NOTIFY`,
      });

      // Push and, if configured, WhatsApp. The banner is what a member sees
      // with the app open; these are how someone who doesn't have it open
      // finds out in time to answer.
      await sendCheckAlert(check.day.userId, check.windowEndsAt);
    }
  }

  return { activated, missed, pointsCharged, underReview, heldForBreak };
}

export type RespondResult =
  | { ok: true; responseSeconds: number }
  | { ok: false; reason: string };

/** A member confirming they are at work. */
export async function respondToCheck(
  userId: string,
  checkId: string,
  now = new Date(),
): Promise<RespondResult> {
  // Settle first, so a check whose window closed a moment ago cannot be
  // answered late by a client that was slow to poll.
  await settleChecks({ userId, now });

  const check = await prisma.availabilityCheck.findUnique({
    where: { id: checkId },
    include: { day: { select: { userId: true } } },
  });

  if (!check) return { ok: false, reason: "That check no longer exists." };
  if (check.day.userId !== userId) {
    return { ok: false, reason: "That check isn't yours." };
  }
  if (check.status === "PASSED") {
    return {
      ok: true,
      responseSeconds: check.respondedAt
        ? Math.round((check.respondedAt.getTime() - check.scheduledAt.getTime()) / 1000)
        : 0,
    };
  }
  if (check.status !== "ACTIVE") {
    return {
      ok: false,
      reason:
        check.status === "MISSED"
          ? "That check's window has closed."
          : "That check isn't active.",
    };
  }

  await prisma.availabilityCheck.update({
    where: { id: check.id },
    data: { status: "PASSED", respondedAt: now },
  });

  return {
    ok: true,
    responseSeconds: Math.max(
      0,
      Math.round((now.getTime() - check.scheduledAt.getTime()) / 1000),
    ),
  };
}

// ---------------------------------------------------------------------------
// Protected breaks
// ---------------------------------------------------------------------------

export type BreakResult = { ok: true; id: string } | { ok: false; reason: string };

/**
 * Starts a protected break.
 *
 * Refused while a check is ACTIVE. That single rule is what separates a
 * protected break from an escape hatch: without it, the sequence "check fires
 * → tap On break → immune" would make the whole availability system optional.
 * Prayer and meals are protected; answering a check that is already on screen
 * takes seconds and is not.
 */
export async function startBreak(
  userId: string,
  reason: string,
  now = new Date(),
): Promise<BreakResult> {
  const day = karachiDay(now);

  const open = await prisma.breakSession.findFirst({ where: { userId, endedAt: null } });
  if (open) return { ok: false, reason: "You're already on a break." };

  const record = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: day } },
    include: { checks: true },
  });

  if (!record?.clockInAt) {
    return { ok: false, reason: "Start your day before taking a break." };
  }
  if (record.clockOutAt) {
    return { ok: false, reason: "Your day is already finished." };
  }

  const active = record.checks.find((check) => check.status === "ACTIVE");
  if (active) {
    return {
      ok: false,
      reason: "Answer the availability check on screen first — it only takes a tap.",
    };
  }

  const session = await prisma.breakSession.create({
    data: { userId, date: day, reason, startedAt: now },
  });

  return { ok: true, id: session.id };
}

export type EndBreakResult =
  | { ok: true; minutes: number; checksShifted: number; checksDropped: number }
  | { ok: false; reason: string };

/**
 * Ends the break and puts the frozen checks back into the day.
 *
 * A check whose window was swallowed by the break is re-scheduled for shortly
 * after it. One that no longer fits before the day's cutoff is CANCELLED —
 * dropped, never missed. The member was never actually put the question.
 */
export async function endBreak(userId: string, now = new Date()): Promise<EndBreakResult> {
  const settings = await getSettings();

  const session = await prisma.breakSession.findFirst({
    where: { userId, endedAt: null },
    orderBy: { startedAt: "desc" },
  });
  if (!session) return { ok: false, reason: "You're not on a break." };

  const minutes = minutesBetween(session.startedAt, now);

  await prisma.breakSession.update({
    where: { id: session.id },
    data: { endedAt: now, minutes },
  });

  const day = karachiDay(now);
  const record = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId, date: day } },
    include: { checks: true },
  });

  let checksShifted = 0;
  let checksDropped = 0;

  if (record) {
    const latestScheduledAt = karachiInstant(day, effectiveCheckLatest(settings));

    // Anything that came due while the member was away.
    const swallowed = record.checks.filter(
      (check) => check.status === "SCHEDULED" && check.scheduledAt <= now,
    );

    for (const check of swallowed) {
      const outcome = shiftCheckAfterBreak({
        breakEndedAt: now,
        settleMinutes: BREAK_SETTLE_MINUTES,
        windowMinutes: settings.checkWindowMinutes,
        latestScheduledAt,
      });

      if (outcome.action === "DROP") {
        await prisma.availabilityCheck.update({
          where: { id: check.id },
          data: { status: "CANCELLED" },
        });
        checksDropped += 1;
        continue;
      }

      await prisma.availabilityCheck.update({
        where: { id: check.id },
        data: {
          scheduledAt: outcome.scheduledAt,
          windowEndsAt: outcome.windowEndsAt,
          deferrals: check.deferrals + 1,
        },
      });
      checksShifted += 1;
    }
  }

  return { ok: true, minutes, checksShifted, checksDropped };
}

/** Minutes of grace after a break before a shifted check may fire. */
export const BREAK_SETTLE_MINUTES = 5;

/** A member's break state for the day: what's open and what's left. */
export async function breakStateFor(userId: string, now = new Date()) {
  const settings = await getSettings();
  const day = karachiDay(now);

  const sessions = await prisma.breakSession.findMany({
    where: { userId, date: day },
    orderBy: { startedAt: "asc" },
  });

  const open = sessions.find((session) => !session.endedAt) ?? null;
  const used = breakMinutesUsed(sessions, now);

  return {
    open: open
      ? { id: open.id, reason: open.reason, startedAt: open.startedAt }
      : null,
    sessions,
    allowance: breakAllowance(used, settings.breakAllowanceMinutes),
  };
}

// ---------------------------------------------------------------------------
// Daily settlement — absences and unclosed days
// ---------------------------------------------------------------------------

export type DailySweepResult = {
  markedAbsent: number;
  autoClosed: number;
  checksActivated: number;
  checksMissed: number;
  attendancePointsCharged: number;
};

/**
 * The daily pass, run by /api/cron/evaluate.
 *
 * Settles overdue checks, marks people absent who never started, and closes
 * days nobody clocked out of. Every step is idempotent.
 */
export async function runDailyAttendanceSweep(now = new Date()): Promise<DailySweepResult> {
  const settings = await getSettings();
  const settled = await settleChecks({ now });

  const day = karachiDay(now);
  const minutes = karachiMinutes(now);

  let markedAbsent = 0;
  let attendancePointsCharged = settled.pointsCharged;

  // Absent: past the cutoff on a working day, with no clock-in and no leave.
  if (minutes >= settings.absentCutoffMinutes && settings.workdays.includes(karachiWeekday(now))) {
    const members = await prisma.user.findMany({
      where: { role: "MEMBER", isActive: true },
      select: { id: true },
    });

    for (const member of members) {
      const kind = await dayKind(member.id, now, settings);
      if (kind.kind !== "WORKDAY") continue;

      const existing = await prisma.attendanceDay.findUnique({
        where: { userId_date: { userId: member.id, date: day } },
      });

      if (existing?.clockInAt) continue;
      if (existing?.status === "ABSENT") continue;

      const record = await prisma.attendanceDay.upsert({
        where: { userId_date: { userId: member.id, date: day } },
        update: { status: "ABSENT" },
        create: { userId: member.id, date: day, status: "ABSENT" },
      });
      markedAbsent += 1;

      attendancePointsCharged += await applyEvents(
        [
          {
            userId: member.id,
            milestoneId: null,
            type: "ABSENT_DAY",
            points: attendanceDeduction(settings.penaltyAbsentDay),
            reason: `No clock-in by ${formatKarachiClock(settings.absentCutoffMinutes)} and no approved leave.`,
            dedupeKey: `day:${record.id}:ABSENT`,
          },
        ],
        { at: now },
      );
    }
  }

  // Auto-close: someone worked but forgot to end their day. No penalty in v1;
  // the day is flagged so the owner can see it happened.
  let autoClosed = 0;
  if (minutes >= settings.shiftEndMinutes) {
    const open = await prisma.attendanceDay.findMany({
      where: { date: day, clockInAt: { not: null }, clockOutAt: null },
    });

    for (const record of open) {
      const closeAt = new Date(
        karachiDay(now).getTime() + (settings.shiftEndMinutes - 5 * 60) * 60_000,
      );

      await prisma.attendanceDay.update({
        where: { id: record.id },
        data: {
          clockOutAt: closeAt,
          autoClosed: true,
          totalMinutes: minutesBetween(record.clockInAt!, closeAt),
        },
      });
      autoClosed += 1;
    }
  }

  // Days that are simply not workable get a status so the calendar is complete
  // rather than full of gaps.
  await markNonWorkingDay(now, settings);

  return {
    markedAbsent,
    autoClosed,
    checksActivated: settled.activated,
    checksMissed: settled.missed,
    attendancePointsCharged,
  };
}

/** Records OFF / LEAVE days so the month view has no unexplained blanks. */
async function markNonWorkingDay(now: Date, settings: AgencySettings): Promise<void> {
  const day = karachiDay(now);
  const isOff = !settings.workdays.includes(karachiWeekday(now));

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    select: { id: true },
  });

  for (const member of members) {
    const kind = await dayKind(member.id, now, settings);
    const status: DayStatus | null =
      isOff && kind.kind === "OFF" ? "OFF" : kind.kind === "LEAVE" ? "LEAVE" : null;

    if (!status) continue;

    await prisma.attendanceDay.upsert({
      where: { userId_date: { userId: member.id, date: day } },
      update: { status },
      create: { userId: member.id, date: day, status },
    });
  }
}
