/**
 * Client commercial numbers: the arithmetic, and the alert rule.
 *
 * Pure — no Prisma, no clock. Ratios are computed here and never stored,
 * because a stored ratio is a number that can disagree with its own inputs the
 * moment one of them is corrected.
 */

export type KpiInput = {
  /** Monday of the week, at UTC midnight. */
  weekStart: Date;
  googleSpend: number;
  metaSpend: number;
  revenue: number;
  orders: number;
  storeSessions: number;
};

export type KpiWeek = KpiInput & {
  spend: number;
  /** Revenue ÷ spend. Null when nothing was spent — not zero. */
  roas: number | null;
  /** Orders ÷ sessions, as a percentage. Null with no sessions. */
  conversionRate: number | null;
  /** Revenue ÷ orders. Null with no orders. */
  averageOrderValue: number | null;
  /** Spend ÷ orders. Null with no orders. */
  costPerOrder: number | null;
};

/**
 * Derives the ratios for one week.
 *
 * Every one of them is null rather than zero when its denominator is empty.
 * A week with no spend has no ROAS — reporting 0.0 would put it below every
 * target and fire an alert about a week nobody ran ads in.
 */
export function deriveWeek(entry: KpiInput): KpiWeek {
  const spend = entry.googleSpend + entry.metaSpend;

  return {
    ...entry,
    spend,
    roas: spend > 0 ? round(entry.revenue / spend, 2) : null,
    conversionRate:
      entry.storeSessions > 0 ? round((entry.orders / entry.storeSessions) * 100, 2) : null,
    averageOrderValue: entry.orders > 0 ? round(entry.revenue / entry.orders, 2) : null,
    costPerOrder: entry.orders > 0 ? round(spend / entry.orders, 2) : null,
  };
}

export type KpiTrend = {
  /** Positive when the latest week improved on the one before. */
  delta: number | null;
  deltaPercent: number | null;
  direction: "up" | "down" | "flat" | "unknown";
};

/**
 * Week-on-week movement for a single measure.
 *
 * `unknown` rather than `flat` when there is nothing to compare to: a first
 * week of data is not a flat trend, and drawing it as one implies a stability
 * that hasn't been observed.
 */
export function trend(latest: number | null, previous: number | null): KpiTrend {
  if (latest === null || previous === null) {
    return { delta: null, deltaPercent: null, direction: "unknown" };
  }

  const delta = round(latest - previous, 2);

  return {
    delta,
    deltaPercent: previous === 0 ? null : Math.round(((latest - previous) / previous) * 100),
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

/**
 * How many of the most recent weeks ran below target, consecutively.
 *
 * Counts backwards from the latest week and stops at the first week that met
 * the target or had no ROAS at all. A week with no spend breaks the streak
 * rather than continuing it — the client paused, they didn't underperform.
 */
export function consecutiveWeeksBelow(
  weeks: readonly { roas: number | null }[],
  target: number,
): number {
  let count = 0;

  for (let index = weeks.length - 1; index >= 0; index -= 1) {
    const roas = weeks[index].roas;
    if (roas === null) break;
    if (roas >= target) break;
    count += 1;
  }

  return count;
}

export type RoasAlert = {
  firing: boolean;
  weeksBelow: number;
  target: number;
  latestRoas: number | null;
};

/**
 * The early-warning rule.
 *
 * Two consecutive weeks under target by default, not one. A single bad week is
 * noise — a creative refresh, a stock-out, a holiday — and an alert that fires
 * on noise gets muted, at which point it can never warn about the real thing.
 */
export function roasAlert(
  weeks: readonly { roas: number | null }[],
  target: number,
  requiredWeeks = 2,
): RoasAlert {
  const weeksBelow = consecutiveWeeksBelow(weeks, target);
  const latest = weeks.length > 0 ? weeks[weeks.length - 1].roas : null;

  return {
    firing: weeksBelow >= requiredWeeks,
    weeksBelow,
    target,
    latestRoas: latest,
  };
}

/** The Monday of the week a date falls in, at UTC midnight. */
export function weekStartOf(date: Date): Date {
  const day = date.getUTCDay() || 7;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  monday.setUTCDate(monday.getUTCDate() - (day - 1));
  return monday;
}

/** Totals across a run of weeks, with the ratios re-derived from the totals. */
export function summarise(weeks: readonly KpiWeek[]) {
  const spend = weeks.reduce((sum, week) => sum + week.spend, 0);
  const revenue = weeks.reduce((sum, week) => sum + week.revenue, 0);
  const orders = weeks.reduce((sum, week) => sum + week.orders, 0);
  const sessions = weeks.reduce((sum, week) => sum + week.storeSessions, 0);

  return {
    weeks: weeks.length,
    spend,
    revenue,
    orders,
    sessions,
    // Re-derived from the totals rather than averaged across weeks: the mean of
    // weekly ROAS over-weights a quiet week with a freak ratio.
    roas: spend > 0 ? round(revenue / spend, 2) : null,
    conversionRate: sessions > 0 ? round((orders / sessions) * 100, 2) : null,
  };
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
