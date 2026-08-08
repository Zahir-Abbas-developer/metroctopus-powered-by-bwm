import { prisma } from "@/lib/prisma";
import { applyEvents } from "@/lib/score-service";
import { attendanceDeduction } from "@/lib/scoring";
import { notify } from "@/lib/notifications";
import { getSettings, effectiveCheckLatest, type AgencySettings } from "@/lib/settings";
import { planChecksForDay } from "@/lib/attendance-schedule";
import {
  formatKarachiClock,
  formatKarachiRange,
  formatKarachiTime,
  karachiDay,
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
};

/**
 * Moves every check that is now due into its next state.
 *
 * Called on every attendance read and by the daily job. Scoped to one member
 * when a member triggers it, and to everyone when the job does.
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

  for (const check of due) {
    // Past its window and unanswered.
    if (check.windowEndsAt <= now) {
      if (check.status === "MISSED") continue;

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
        type: "DUE_TOMORROW",
        title: "Availability check",
        body: `Confirm you're at work — you have until ${formatKarachiTime(check.windowEndsAt)}.`,
        href: "/my-attendance",
        dedupeKey: `check:${check.id}:NOTIFY`,
      });
    }
  }

  return { activated, missed, pointsCharged };
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
