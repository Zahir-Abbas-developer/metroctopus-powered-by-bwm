/**
 * The two things that can excuse an availability check: a declared outage and
 * a protected break.
 *
 * Pure — no Prisma, no clock, no timezone lookup. Both rules are ultimately
 * interval arithmetic, and interval arithmetic is exactly the kind of code
 * that is wrong in one direction at the boundary and nobody notices for a
 * month. Keeping it here means it can be tested exhaustively.
 */

export const OUTAGE_TYPES = ["POWER", "INTERNET"] as const;
export type OutageType = (typeof OUTAGE_TYPES)[number];

export const OUTAGE_TYPE_LABEL: Record<OutageType, string> = {
  POWER: "Power cut",
  INTERNET: "Internet down",
};

export const BREAK_REASONS = ["PRAYER", "MEAL", "PERSONAL"] as const;
export type BreakReason = (typeof BREAK_REASONS)[number];

export const BREAK_REASON_LABEL: Record<BreakReason, string> = {
  PRAYER: "Prayer",
  MEAL: "Meal",
  PERSONAL: "Personal",
};

export type Interval = { start: Date; end: Date };

/**
 * Do two half-open intervals share any time at all?
 *
 * Half-open on purpose: an outage that ends at 16:00 does not cover a check
 * whose window opens at exactly 16:00. Touching at a single instant is not an
 * overlap, and treating it as one would hand out an excuse for a check that
 * began after the lights came back on.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();
}

/**
 * Which of a member's checks a declared outage covers.
 *
 * A check is covered when the outage overlaps its response window at all. The
 * member could not have answered during the outage, and requiring the whole
 * window to be covered would deny the excuse to someone whose power came back
 * with four minutes left on a sixty-minute window.
 */
export function checksCoveredByOutage<T extends { scheduledAt: Date; windowEndsAt: Date }>(
  checks: readonly T[],
  outage: Interval,
): T[] {
  return checks.filter((check) =>
    overlaps({ start: check.scheduledAt, end: check.windowEndsAt }, outage),
  );
}

/** Total minutes across a set of closed intervals, floored per interval. */
export function totalMinutes(intervals: readonly Interval[]): number {
  return intervals.reduce(
    (sum, interval) =>
      sum + Math.max(0, Math.floor((interval.end.getTime() - interval.start.getTime()) / 60_000)),
    0,
  );
}

// ---------------------------------------------------------------------------
// Breaks
// ---------------------------------------------------------------------------

export type BreakShiftConfig = {
  /** When the break ended — the earliest the check could now be answered. */
  breakEndedAt: Date;
  /** Minutes of grace after a break before a check may fire. */
  settleMinutes: number;
  /** The check's response window length. */
  windowMinutes: number;
  /** The latest instant a check may be *scheduled* at today. */
  latestScheduledAt: Date;
};

export type BreakShiftOutcome =
  | { action: "SHIFT"; scheduledAt: Date; windowEndsAt: Date }
  | { action: "DROP"; reason: string };

/**
 * Where a check goes when a break swallowed its window.
 *
 * Shifted to just after the break, or dropped entirely when it no longer fits
 * before the day's cutoff. Dropped means CANCELLED, never MISSED: a check the
 * member was never actually put is not one they can fail. That is the whole
 * point of the rule, and it is the case most likely to be got wrong, so it is
 * stated here rather than inferred at the call site.
 */
export function shiftCheckAfterBreak(config: BreakShiftConfig): BreakShiftOutcome {
  const scheduledAt = new Date(
    config.breakEndedAt.getTime() + config.settleMinutes * 60_000,
  );

  if (scheduledAt.getTime() > config.latestScheduledAt.getTime()) {
    return {
      action: "DROP",
      reason: "No room left in the day after the break — dropped, not missed.",
    };
  }

  return {
    action: "SHIFT",
    scheduledAt,
    windowEndsAt: new Date(scheduledAt.getTime() + config.windowMinutes * 60_000),
  };
}

/**
 * Minutes of break taken on a day, counting an open break up to `now`.
 *
 * An open break counts as it runs. A member on a two-hour "break" should show
 * as over allowance while it is happening, not once they come back.
 */
export function breakMinutesUsed(
  sessions: readonly { startedAt: Date; endedAt: Date | null; minutes: number | null }[],
  now: Date,
): number {
  return sessions.reduce((sum, session) => {
    if (session.endedAt) return sum + (session.minutes ?? 0);
    return sum + Math.max(0, Math.floor((now.getTime() - session.startedAt.getTime()) / 60_000));
  }, 0);
}

export type BreakAllowance = {
  used: number;
  allowance: number;
  remaining: number;
  overBy: number;
  /** True once the allowance is spent — amber on the owner's board, no charge. */
  exceeded: boolean;
};

export function breakAllowance(used: number, allowance: number): BreakAllowance {
  const remaining = Math.max(0, allowance - used);
  const overBy = Math.max(0, used - allowance);
  return { used, allowance, remaining, overBy, exceeded: overBy > 0 };
}
