/**
 * The arithmetic behind rolling a retainer cycle forward.
 *
 * Pure: no Prisma, no clock. Auto-renewal runs unattended at 2am and creates
 * a month of dated work for every active client, so the date shifting is
 * exactly the kind of code that must be provable rather than eyeballed.
 */

const DAY_MS = 86_400_000;

/** Days in the cycle, inclusive of both ends. */
export function cycleLengthDays(startDate: Date, endDate: Date): number {
  return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS));
}

export type RenewalWindow = {
  startDate: Date;
  endDate: Date;
  /** How far every date moves, in days. */
  shiftDays: number;
};

/**
 * The next cycle's window.
 *
 * It starts the day after the old one ended, and runs for the same number of
 * days. Deliberately *not* "the 1st to the end of the month": a client
 * onboarded on the 12th is on a 12th-to-11th cycle, and snapping their renewal
 * to a calendar month would silently give them a short month and shift every
 * deadline they have already agreed to.
 */
export function nextCycleWindow(previous: {
  startDate: Date;
  endDate: Date;
}): RenewalWindow {
  const length = cycleLengthDays(previous.startDate, previous.endDate);
  const startDate = new Date(previous.endDate.getTime() + DAY_MS);
  const endDate = new Date(startDate.getTime() + length * DAY_MS);

  return {
    startDate,
    endDate,
    shiftDays: Math.round((startDate.getTime() - previous.startDate.getTime()) / DAY_MS),
  };
}

/**
 * A milestone's date in the new cycle.
 *
 * Shifted by the same number of days the cycle moved, then clamped inside the
 * new window. Clamping matters: a milestone dated after the old cycle's end
 * (someone pushed it out by hand) would otherwise land outside the new cycle
 * and never appear on the board.
 */
export function shiftDueDate(
  dueDate: Date,
  window: RenewalWindow,
): Date {
  const shifted = new Date(dueDate.getTime() + window.shiftDays * DAY_MS);

  if (shifted < window.startDate) return window.startDate;
  if (shifted > window.endDate) return window.endDate;
  return shifted;
}

/**
 * When unfinished work from the closed cycle is due in the new one.
 *
 * A few days in rather than on day one: carried-over work arrives alongside a
 * full new month of milestones, and dating it to the 1st guarantees it is late
 * again immediately. Clamped to the cycle end for very short cycles.
 */
export function carryOverDueDate(window: RenewalWindow, dueDays: number): Date {
  const target = new Date(window.startDate.getTime() + Math.max(0, dueDays) * DAY_MS);
  return target > window.endDate ? window.endDate : target;
}

/**
 * "Dec 2026 Retainer" — the new cycle's title.
 *
 * Named for the month the cycle *starts* in, in agency time. A cycle running
 * 12 Dec to 11 Jan is the December retainer to everyone involved, and titling
 * it January because that is where it ends would be nobody's mental model.
 */
export function cycleTitle(startDate: Date): string {
  const label = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Karachi",
    month: "short",
    year: "numeric",
  }).format(startDate);
  return `${label} Retainer`;
}

/** Statuses whose work is unfinished and so worth carrying into the new cycle. */
export const CARRY_OVER_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "MISSED"] as const;

/**
 * Whether a milestone is *unfinished work being carried*, as opposed to
 * recurring work being regenerated.
 *
 * Every milestone in a cycle is cloned into the next one — a retainer's "Week 1
 * report" happens again next month, so COMPLETED and SUBMITTED work reappears
 * on its normal schedule with shifted dates. This flag decides something
 * narrower: whether the copy is marked `carriedOver` and re-dated a few days
 * into the new cycle because the original was never delivered.
 *
 * SUBMITTED is excluded on purpose. The work *was* delivered and is sitting in
 * the owner's review queue; the new cycle's copy is next month's instance of
 * the same deliverable, not a second attempt at last month's.
 */
export function shouldCarryOver(status: string): boolean {
  return (CARRY_OVER_STATUSES as readonly string[]).includes(status);
}
