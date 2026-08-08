/**
 * The performance scoring engine.
 *
 * Deliberately pure: no Prisma, no clock, no timezone lookups. Every function
 * takes its inputs explicitly and returns plain data, so the rules can be unit
 * tested exhaustively (see tests/scoring.test.ts) and so the same code can run
 * in an API route, a cron job or a report generator without surprises.
 *
 * The rules, exactly as specified:
 *
 *   Every member starts each calendar month at 100 points.
 *
 *   LATE         completed after the deadline
 *                -> weight x 1, plus 0.5 x weight per additional full 24h,
 *                   capped at weight x 3 for that milestone
 *   MISSED       still not completed when the project ends -> weight x 4
 *   REJECTED     admin sends a SUBMITTED milestone back    -> weight x 0.5,
 *                   charged again on every rejection
 *   EARLY_BONUS  completed 24h or more before the deadline -> +1
 *
 *   Monthly score = 100 + sum(that month's events), clamped to 0..100.
 *
 * Points are always multiples of 0.5. That matters: 0.5 is exactly
 * representable in binary floating point, so summing a ledger of these values
 * never accumulates drift the way 0.1 would.
 */

import { DAY_MS } from "@/lib/date";

export const MONTHLY_BASELINE = 100;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

export const SCORE_EVENT_TYPES = [
  "LATE",
  "MISSED",
  "REJECTED",
  "EARLY_BONUS",
  "MANUAL_ADJUST",
] as const;

export type ScoreEventType = (typeof SCORE_EVENT_TYPES)[number];

export const SCORE_EVENT_LABEL: Record<ScoreEventType, string> = {
  LATE: "Late delivery",
  MISSED: "Missed deadline",
  REJECTED: "Work rejected",
  EARLY_BONUS: "Delivered early",
  MANUAL_ADJUST: "Manual adjustment",
};

/** Multipliers applied to a milestone's weight. */
export const RATES = {
  /** Base charge the moment a delivery is late at all. */
  LATE_BASE: 1,
  /** Added per additional complete 24h beyond the deadline. */
  LATE_PER_EXTRA_DAY: 0.5,
  /** Ceiling on the total late charge for any single milestone. */
  LATE_CAP: 3,
  /** Charged when a project ends with the milestone unfinished. */
  MISSED: 4,
  /** Charged on each rejection of submitted work. */
  REJECTED: 0.5,
} as const;

/** Flat bonus, not weight-scaled — early delivery is early delivery. */
export const EARLY_BONUS_POINTS = 1;
/** How far ahead of the deadline delivery has to land to earn the bonus. */
export const EARLY_BONUS_THRESHOLD_MS = DAY_MS;

// ---------------------------------------------------------------------------
// Individual rules
// ---------------------------------------------------------------------------

function round(points: number): number {
  // Guards against a stray float tail if a caller passes a non-half weight.
  return Math.round(points * 100) / 100;
}

/**
 * Points lost for delivering after the deadline. Returns 0 when on time, and
 * a negative number otherwise.
 */
export function lateDeduction(
  weight: number,
  deadline: Date,
  completedAt: Date,
): number {
  const lateBy = completedAt.getTime() - deadline.getTime();
  if (lateBy <= 0) return 0;

  const extraFullDays = Math.floor(lateBy / DAY_MS);
  const raw =
    weight * RATES.LATE_BASE + extraFullDays * weight * RATES.LATE_PER_EXTRA_DAY;
  const capped = Math.min(raw, weight * RATES.LATE_CAP);

  return round(-capped);
}

/** Points lost when a project closes with the milestone unfinished. */
export function missedDeduction(weight: number): number {
  return round(-weight * RATES.MISSED);
}

/** Points lost for one rejection of submitted work. */
export function rejectionDeduction(weight: number): number {
  return round(-weight * RATES.REJECTED);
}

/** True when the delivery landed a full day or more before the deadline. */
export function qualifiesForEarlyBonus(
  deadline: Date,
  completedAt: Date,
): boolean {
  return deadline.getTime() - completedAt.getTime() >= EARLY_BONUS_THRESHOLD_MS;
}

export function earlyBonus(deadline: Date, completedAt: Date): number {
  return qualifiesForEarlyBonus(deadline, completedAt) ? EARLY_BONUS_POINTS : 0;
}

// ---------------------------------------------------------------------------
// Monthly totals and bands
// ---------------------------------------------------------------------------

export function clampScore(score: number): number {
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, score));
}

/**
 * A member's score for one calendar month: the baseline plus every event in
 * that month, clamped. The clamp is why the ledger must stay immutable — the
 * displayed score is a projection of the events, never a stored counter.
 */
export function monthlyScore(points: readonly number[]): number {
  const total = points.reduce((sum, value) => sum + value, MONTHLY_BASELINE);
  return clampScore(round(total));
}

export type ScoreBandKey = "EXCELLENT" | "GOOD" | "ATTENTION" | "CRITICAL";

export type ScoreBand = {
  key: ScoreBandKey;
  label: string;
  /** Palette token name, resolved to a class by the UI. */
  tone: "success" | "info" | "warning" | "danger";
  /** Hex from the fixed palette, for the SVG score ring. */
  color: string;
  min: number;
};

export const SCORE_BANDS: readonly ScoreBand[] = [
  { key: "EXCELLENT", label: "Excellent", tone: "success", color: "#1A6B3A", min: 90 },
  { key: "GOOD", label: "Good", tone: "info", color: "#1A4FA0", min: 75 },
  { key: "ATTENTION", label: "Needs attention", tone: "warning", color: "#C4730A", min: 60 },
  { key: "CRITICAL", label: "Critical", tone: "danger", color: "#C0392B", min: 0 },
];

export function scoreBand(score: number): ScoreBand {
  const clamped = clampScore(score);
  // Bands are ordered high to low, so the first match is the right one.
  return SCORE_BANDS.find((band) => clamped >= band.min) ?? SCORE_BANDS[SCORE_BANDS.length - 1];
}

// ---------------------------------------------------------------------------
// Event proposals (what the evaluation job and the transition handlers apply)
// ---------------------------------------------------------------------------

export type ProposedEvent = {
  userId: string;
  milestoneId: string;
  type: ScoreEventType;
  points: number;
  reason: string;
  /**
   * Stable identity for automatic events. The database has a unique index on
   * it, so applying the same proposal twice is a no-op rather than a second
   * deduction. Repeatable events (REJECTED, MANUAL_ADJUST) carry null.
   */
  dedupeKey: string | null;
};

/** Automatic events are one-per-milestone-per-type; this is that identity. */
export function dedupeKeyFor(milestoneId: string, type: ScoreEventType): string {
  return `${milestoneId}:${type}`;
}

export type MilestoneFacts = {
  id: string;
  title: string;
  weight: number;
  /** Effective deadline — end of the due day in agency time. */
  deadline: Date;
  completedAt: Date | null;
  assigneeId: string | null;
};

/**
 * What an approved (COMPLETED) milestone is worth: a late charge, an early
 * bonus, or nothing at all when it lands in the final 24h before the deadline.
 *
 * `existingKeys` is the set of dedupe keys already in the ledger. Passing it in
 * keeps idempotency a property of this pure function, so re-evaluation can be
 * tested without a database.
 */
export function evaluateCompletion(
  milestone: MilestoneFacts,
  existingKeys: ReadonlySet<string> = new Set(),
): ProposedEvent[] {
  const { id, title, weight, deadline, completedAt, assigneeId } = milestone;
  if (!assigneeId || !completedAt) return [];

  const late = lateDeduction(weight, deadline, completedAt);
  if (late < 0) {
    const key = dedupeKeyFor(id, "LATE");
    if (existingKeys.has(key)) return [];

    const hoursLate = Math.floor((completedAt.getTime() - deadline.getTime()) / 3_600_000);
    return [
      {
        userId: assigneeId,
        milestoneId: id,
        type: "LATE",
        points: late,
        reason: `"${title}" delivered ${describeDelay(hoursLate)} after its deadline (weight ${weight}).`,
        dedupeKey: key,
      },
    ];
  }

  const bonus = earlyBonus(deadline, completedAt);
  if (bonus > 0) {
    const key = dedupeKeyFor(id, "EARLY_BONUS");
    if (existingKeys.has(key)) return [];

    return [
      {
        userId: assigneeId,
        milestoneId: id,
        type: "EARLY_BONUS",
        points: bonus,
        reason: `"${title}" delivered ahead of its deadline.`,
        dedupeKey: key,
      },
    ];
  }

  return [];
}

/**
 * What an unfinished milestone costs when its project closes. A milestone that
 * was already charged LATE is not also charged MISSED — it was delivered, just
 * not on time.
 */
export function evaluateMissed(
  milestone: MilestoneFacts,
  existingKeys: ReadonlySet<string> = new Set(),
): ProposedEvent[] {
  const { id, title, weight, assigneeId, completedAt } = milestone;
  if (!assigneeId || completedAt) return [];

  const key = dedupeKeyFor(id, "MISSED");
  if (existingKeys.has(key)) return [];

  return [
    {
      userId: assigneeId,
      milestoneId: id,
      type: "MISSED",
      points: missedDeduction(weight),
      reason: `"${title}" was never completed before the project closed (weight ${weight}).`,
      dedupeKey: key,
    },
  ];
}

/** A rejection charge. Repeatable by design, so it carries no dedupe key. */
export function rejectionEvent(
  milestone: Pick<MilestoneFacts, "id" | "title" | "weight" | "assigneeId">,
  note: string,
): ProposedEvent | null {
  if (!milestone.assigneeId) return null;

  return {
    userId: milestone.assigneeId,
    milestoneId: milestone.id,
    type: "REJECTED",
    points: rejectionDeduction(milestone.weight),
    reason: `"${milestone.title}" sent back for rework: ${note}`,
    dedupeKey: null,
  };
}

function describeDelay(hours: number): string {
  if (hours < 1) return "less than an hour";
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "-4.0" / "+1.0" — the chip shown against every ledger row. */
export function formatPoints(points: number): string {
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(1)}`;
}
