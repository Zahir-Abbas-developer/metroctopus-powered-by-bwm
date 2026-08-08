/**
 * Capacity planning arithmetic.
 *
 * Pure: no Prisma, no clock. The point of the feature is to stop overload
 * *before* it turns into a missed deadline and a penalty, which means the
 * numbers have to be right at the moment of assignment — not reconstructed
 * afterwards from the misses they caused.
 *
 * Load is measured in estimated hours per ISO week, because a week is the unit
 * people actually plan in. A monthly figure hides the fact that four of
 * someone's five milestones are due in the same three days.
 */

export type LoadBand = "LIGHT" | "HEALTHY" | "TIGHT" | "OVER";

export const LOAD_BAND_TONE: Record<LoadBand, "neutral" | "success" | "warning" | "danger"> = {
  LIGHT: "neutral",
  HEALTHY: "success",
  TIGHT: "warning",
  OVER: "danger",
};

export const LOAD_BAND_LABEL: Record<LoadBand, string> = {
  LIGHT: "Room to spare",
  HEALTHY: "Healthy",
  TIGHT: "Getting tight",
  OVER: "Over capacity",
};

/**
 * Green below 70%, amber to 90%, red above.
 *
 * "Light" exists as a separate band from "healthy" so the owner can see who
 * has room — a utilization grid where everything under 70% looks identical
 * hides the person who could take the next piece of work.
 */
export function loadBand(percent: number): LoadBand {
  if (percent > 90) return "OVER";
  if (percent >= 70) return "TIGHT";
  if (percent >= 35) return "HEALTHY";
  return "LIGHT";
}

export type WeekLoad = {
  /** ISO week key, "2026-W33". */
  week: string;
  hours: number;
  capacityHours: number;
  percent: number;
  band: LoadBand;
  milestones: number;
};

/**
 * Load for one week.
 *
 * A capacity of zero means unavailable, not infinitely available — anyone with
 * work assigned in a week they have no capacity for is over, by definition.
 */
export function weekLoad(
  week: string,
  hours: number,
  capacityHours: number,
  milestones: number,
): WeekLoad {
  const percent =
    capacityHours <= 0
      ? hours > 0
        ? 100
        : 0
      : Math.round((hours / capacityHours) * 100);

  return { week, hours, capacityHours, percent, band: loadBand(percent), milestones };
}

/**
 * The ISO week a date falls in, as "2026-W33".
 *
 * ISO rather than calendar weeks so a week is always Monday–Sunday and always
 * seven days, which matters when the grid is meant to be comparable across
 * months. Computed in UTC against dates already normalised to agency-day
 * midnight by lib/date.ts.
 */
export function isoWeekKey(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // Shift to the Thursday of this week: ISO weeks are numbered by the year
  // their Thursday falls in, which is what makes the turn of the year work.
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);

  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);

  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** The Monday of an ISO week key, as a UTC-midnight date. */
export function isoWeekStart(key: string): Date {
  const [yearPart, weekPart] = key.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);

  // 4 January is always in ISO week 1.
  const fourth = new Date(Date.UTC(year, 0, 4));
  const day = fourth.getUTCDay() || 7;
  const week1Monday = new Date(fourth.getTime() - (day - 1) * 86_400_000);

  return new Date(week1Monday.getTime() + (week - 1) * 7 * 86_400_000);
}

/** Consecutive ISO week keys, starting from the week `from` falls in. */
export function weekKeysFrom(from: Date, count: number): string[] {
  const start = isoWeekStart(isoWeekKey(from));
  return Array.from({ length: count }, (_, index) =>
    isoWeekKey(new Date(start.getTime() + index * 7 * 86_400_000)),
  );
}

// ---------------------------------------------------------------------------
// Assignment suggestions
// ---------------------------------------------------------------------------

export type Candidate = {
  userId: string;
  name: string;
  jobTitle: string;
  /** Load in the week the work is due, before this assignment. */
  percent: number;
  hours: number;
  capacityHours: number;
  /** True when the job title matches the service the work belongs to. */
  qualified: boolean;
};

export type Suggestion = {
  candidate: Candidate;
  /** Load this member would be at if the work were assigned to them. */
  projectedPercent: number;
  reason: string;
};

/**
 * Who should take this work.
 *
 * Qualified people first, then whoever has the most room. Ranking an
 * unqualified but idle person above a qualified one who is merely busy would
 * be optimising the wrong thing — the suggestion exists to break ties inside a
 * discipline, not to reassign Meta Ads to the Shopify designer.
 */
export function suggestAssignee(
  candidates: readonly Candidate[],
  estimatedHours: number,
): Suggestion | null {
  if (candidates.length === 0) return null;

  const projected = (candidate: Candidate) =>
    candidate.capacityHours <= 0
      ? 100
      : Math.round(((candidate.hours + estimatedHours) / candidate.capacityHours) * 100);

  const ranked = [...candidates].sort((a, b) => {
    if (a.qualified !== b.qualified) return a.qualified ? -1 : 1;
    return projected(a) - projected(b);
  });

  const best = ranked[0];
  const projectedPercent = projected(best);

  return {
    candidate: best,
    projectedPercent,
    reason: best.qualified
      ? projectedPercent > 90
        ? `Best fit, but this would take ${best.name.split(" ")[0]} to ${projectedPercent}%`
        : `Matches the service and has the most room (${projectedPercent}% after this)`
      : `Nobody's job title matches — ${best.name.split(" ")[0]} has the most room`,
  };
}

export type OverloadWarning = {
  /** Load before the assignment. */
  currentPercent: number;
  projectedPercent: number;
  week: string;
  /** Only true past 100%, which is where the hard dialog fires. */
  blocking: boolean;
};

/**
 * Whether assigning this work should stop and ask.
 *
 * The dialog is at 100%, not at the amber 70% band. A warning that fires
 * whenever someone is merely busy gets clicked through without reading, and
 * then the one that matters gets clicked through too.
 */
export function overloadWarning(
  currentHours: number,
  capacityHours: number,
  estimatedHours: number,
  week: string,
): OverloadWarning {
  const percent = (hours: number) =>
    capacityHours <= 0 ? (hours > 0 ? 100 : 0) : Math.round((hours / capacityHours) * 100);

  const projectedPercent = percent(currentHours + estimatedHours);

  return {
    currentPercent: percent(currentHours),
    projectedPercent,
    week,
    blocking: projectedPercent > 100,
  };
}
