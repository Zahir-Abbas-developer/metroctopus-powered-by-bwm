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
 *   LATE         submitted after the effective deadline
 *                -> weight x 1, plus 0.5 x weight per additional full 24h,
 *                   capped at weight x 3 for that milestone
 *   MISSED       still not delivered when the project ends -> weight x 4
 *   REJECTED     admin sends a SUBMITTED milestone back    -> weight x 0.5,
 *                   charged again on every rejection
 *   EARLY_BONUS  submitted 24h or more before the deadline -> +1
 *
 *   Monthly score = 100 + sum(that month's events), clamped to 0..100.
 *
 * Points are always multiples of 0.5. That matters: 0.5 is exactly
 * representable in binary floating point, so summing a ledger of these values
 * never accumulates drift the way 0.1 would.
 *
 * ## Engine version 2 (Phase 8) — two fairness corrections
 *
 * **Lateness is judged on submission, never approval.** Version 1 compared
 * `completedAt`, which is stamped when the owner approves. That made a
 * member's score a function of how fast the owner got round to reviewing —
 * a member could submit a day early and still be charged LATE because the
 * review sat for three days. Version 2 compares `submittedAt`. Approval time
 * is now tracked as the owner's own metric and touches nobody's score.
 *
 * **The clock pauses while work is blocked.** Time a milestone spends waiting
 * on a client, an external party or another milestone is added to its
 * deadline, because it is time the assignee could not act in. See
 * `effectiveDeadline`.
 *
 * Both apply from the deploy date forward. Nothing is recomputed retroactively:
 * events already in the ledger were correct under the rules in force when they
 * were written, and silently rewriting history would break the frozen report
 * snapshots that quote them.
 */

import { DAY_MS } from "@/lib/date";
import { describeBlocked } from "@/lib/fairness-types";

export const MONTHLY_BASELINE = 100;
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

export const SCORE_EVENT_TYPES = [
  "LATE",
  "MISSED",
  "REJECTED",
  "EARLY_BONUS",
  "MANUAL_ADJUST",
  // Phase 7 — attendance. These are flat charges rather than weight-scaled:
  // a working day has no "weight", so the amounts come from Settings and are
  // passed in by the caller. See attendanceDeduction below.
  "ATTENDANCE_MISS",
  "LATE_CLOCK_IN",
  "ABSENT_DAY",
  // Phase 9 — business development. Sales work doesn't decompose into dated
  // deliverables, so it is scored on activity and outcomes instead — but into
  // the same ledger, so a score stays 100 + sum(that month's events) however
  // it was earned.
  "DEAL_WON",
  "TARGET_MET",
  "TARGET_MISSED",
  // Phase 10 — outcomes, not just punctuality. Work can land on time and
  // still be wrong.
  "QUALITY_BONUS",
  "QUALITY_FLAG",
] as const;

export type ScoreEventType = (typeof SCORE_EVENT_TYPES)[number];

export const SCORE_EVENT_LABEL: Record<ScoreEventType, string> = {
  LATE: "Late delivery",
  MISSED: "Missed deadline",
  REJECTED: "Work rejected",
  EARLY_BONUS: "Delivered early",
  MANUAL_ADJUST: "Manual adjustment",
  ATTENDANCE_MISS: "Missed availability check",
  LATE_CLOCK_IN: "Late start",
  ABSENT_DAY: "Absent",
  DEAL_WON: "Deal won",
  TARGET_MET: "Weekly target met",
  TARGET_MISSED: "Weekly target missed",
  QUALITY_BONUS: "Outstanding work",
  QUALITY_FLAG: "Quality below standard",
};

/** The attendance events, for anywhere that needs to treat them as a group. */
export const ATTENDANCE_EVENT_TYPES = [
  "ATTENDANCE_MISS",
  "LATE_CLOCK_IN",
  "ABSENT_DAY",
] as const;

export function isAttendanceEvent(type: string): boolean {
  return (ATTENDANCE_EVENT_TYPES as readonly string[]).includes(type);
}

/** The business-development events, for anywhere that groups them. */
export const PIPELINE_EVENT_TYPES = ["DEAL_WON", "TARGET_MET", "TARGET_MISSED"] as const;

export function isPipelineEvent(type: string): boolean {
  return (PIPELINE_EVENT_TYPES as readonly string[]).includes(type);
}

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
 * The deadline a milestone is actually judged against.
 *
 * Blocked time is added on, because a member cannot act on work that is
 * waiting for someone else. Blocking is what makes the pause auditable: this
 * function only does the arithmetic, and the minutes it is handed come from
 * BlockPeriod rows the owner can see and veto.
 */
export function effectiveDeadline(deadline: Date, blockedMinutes = 0): Date {
  if (blockedMinutes <= 0) return deadline;
  return new Date(deadline.getTime() + blockedMinutes * 60_000);
}

/**
 * Points lost for submitting after the deadline. Returns 0 when on time, and
 * a negative number otherwise.
 */
export function lateDeduction(
  weight: number,
  deadline: Date,
  submittedAt: Date,
): number {
  const lateBy = submittedAt.getTime() - deadline.getTime();
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

/**
 * Points lost for an attendance failure.
 *
 * Unlike delivery penalties there is no weight to scale by — a missed check is
 * a missed check — so the amount is configured per agency and handed in. The
 * sign is normalised here so a positive setting can never accidentally reward
 * someone for being absent.
 */
export function attendanceDeduction(configuredPenalty: number): number {
  return round(-Math.abs(configuredPenalty));
}

/** True when the submission landed a full day or more before the deadline. */
export function qualifiesForEarlyBonus(
  deadline: Date,
  submittedAt: Date,
): boolean {
  return deadline.getTime() - submittedAt.getTime() >= EARLY_BONUS_THRESHOLD_MS;
}

export function earlyBonus(deadline: Date, submittedAt: Date): number {
  return qualifiesForEarlyBonus(deadline, submittedAt) ? EARLY_BONUS_POINTS : 0;
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
  /**
   * Null for events that are not about a milestone — the attendance charges,
   * for instance. It is a real foreign key, so "" is a constraint violation
   * rather than an empty value.
   */
  milestoneId: string | null;
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
  /** End of the due day in agency time, before any blocked time is added. */
  deadline: Date;
  /**
   * Minutes the milestone spent blocked. Added to the deadline, so waiting on
   * a client never costs the assignee points.
   */
  blockedMinutes?: number;
  /**
   * When the member handed the work in — the only thing lateness is judged on.
   * Null means nothing has been submitted yet.
   */
  submittedAt: Date | null;
  /** When the owner approved. Marks the work delivered; never times it. */
  completedAt: Date | null;
  assigneeId: string | null;
};

/**
 * What an approved (COMPLETED) milestone is worth: a late charge, an early
 * bonus, or nothing at all when it lands in the final 24h before the deadline.
 *
 * Judged on `submittedAt` against the blocked-adjusted deadline. A milestone
 * approved without ever being submitted proposes nothing — there is no
 * delivery moment to time, and falling back to the approval would reintroduce
 * exactly the unfairness this version removes. The status route stamps
 * `submittedAt` when the owner completes unsubmitted work, so in practice this
 * guard only catches imported or hand-edited data.
 *
 * `existingKeys` is the set of dedupe keys already in the ledger. Passing it in
 * keeps idempotency a property of this pure function, so re-evaluation can be
 * tested without a database.
 */
export function evaluateCompletion(
  milestone: MilestoneFacts,
  existingKeys: ReadonlySet<string> = new Set(),
): ProposedEvent[] {
  const { id, title, weight, completedAt, submittedAt, assigneeId } = milestone;
  if (!assigneeId || !completedAt || !submittedAt) return [];

  const deadline = effectiveDeadline(milestone.deadline, milestone.blockedMinutes ?? 0);
  const shifted = (milestone.blockedMinutes ?? 0) > 0;

  const late = lateDeduction(weight, deadline, submittedAt);
  if (late < 0) {
    const key = dedupeKeyFor(id, "LATE");
    if (existingKeys.has(key)) return [];

    const hoursLate = Math.floor((submittedAt.getTime() - deadline.getTime()) / 3_600_000);
    return [
      {
        userId: assigneeId,
        milestoneId: id,
        type: "LATE",
        points: late,
        reason:
          `"${title}" submitted ${describeDelay(hoursLate)} after its deadline (weight ${weight})` +
          `${shifted ? `, deadline already extended by ${describeBlocked(milestone.blockedMinutes ?? 0)} of blocked time` : ""}.`,
        dedupeKey: key,
      },
    ];
  }

  const bonus = earlyBonus(deadline, submittedAt);
  if (bonus > 0) {
    const key = dedupeKeyFor(id, "EARLY_BONUS");
    if (existingKeys.has(key)) return [];

    return [
      {
        userId: assigneeId,
        milestoneId: id,
        type: "EARLY_BONUS",
        points: bonus,
        reason: `"${title}" submitted ahead of its deadline.`,
        dedupeKey: key,
      },
    ];
  }

  return [];
}

/**
 * What an undelivered milestone costs when its project closes. A milestone
 * that was already charged LATE is not also charged MISSED — it was delivered,
 * just not on time.
 *
 * "Delivered" means submitted, not approved. Work sitting in the owner's
 * review queue when the cycle closes is the owner's backlog, not the member's
 * failure, and charging weight x 4 for it would be the same unfairness that
 * moved lateness onto submission in the first place.
 */
export function evaluateMissed(
  milestone: MilestoneFacts,
  existingKeys: ReadonlySet<string> = new Set(),
): ProposedEvent[] {
  const { id, title, weight, assigneeId, completedAt, submittedAt } = milestone;
  if (!assigneeId || completedAt || submittedAt) return [];

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

// ---------------------------------------------------------------------------
// Quality
// ---------------------------------------------------------------------------

export const QUALITY_MIN = 1;
export const QUALITY_MAX = 5;

/** Ratings at or below this need a written comment. */
export const QUALITY_COMMENT_THRESHOLD = 2;

export type QualityConfig = {
  bonusHigh: number;
  penaltyLow: number;
};

export const DEFAULT_QUALITY_CONFIG: QualityConfig = { bonusHigh: 0.5, penaltyLow: 1 };

/**
 * What a star rating is worth.
 *
 * Five is a small bonus, one or two a small charge, and three or four nothing
 * at all. The neutral band is the important part: most work is simply fine,
 * and a scale where every rating moves the score would push an owner towards
 * rating everything a 4 to avoid a conversation — which would make the whole
 * measure meaningless.
 *
 * The amounts are deliberately smaller than a missed deadline. Lateness is
 * objective; a star rating is one person's judgement on one afternoon, and it
 * should nudge a score rather than decide it.
 */
export function qualityPoints(
  rating: number,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): number {
  if (rating >= QUALITY_MAX) return round(Math.abs(config.bonusHigh));
  if (rating <= QUALITY_COMMENT_THRESHOLD) return round(-Math.abs(config.penaltyLow));
  return 0;
}

export function requiresQualityComment(rating: number): boolean {
  return rating <= QUALITY_COMMENT_THRESHOLD;
}

/**
 * The score event for a rating, or null when the rating is neutral.
 *
 * Keyed per milestone, so re-approving after a correction cannot charge twice.
 * A rating that is *changed* needs a compensating adjustment rather than a
 * second event — the ledger is append-only.
 */
export function qualityEvent(
  milestone: Pick<MilestoneFacts, "id" | "title" | "assigneeId">,
  rating: number,
  comment: string | null,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): ProposedEvent | null {
  if (!milestone.assigneeId) return null;

  const points = qualityPoints(rating, config);
  if (points === 0) return null;

  const high = points > 0;

  return {
    userId: milestone.assigneeId,
    milestoneId: milestone.id,
    type: high ? "QUALITY_BONUS" : "QUALITY_FLAG",
    points,
    reason: high
      ? `"${milestone.title}" rated ${rating}/5 — outstanding.`
      : `"${milestone.title}" rated ${rating}/5${comment ? `: ${comment}` : ""}`,
    dedupeKey: dedupeKeyFor(milestone.id, high ? "QUALITY_BONUS" : "QUALITY_FLAG"),
  };
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

/** Re-exported: how much the deadline moved, used in ledger reasons. */
export { describeBlocked } from "@/lib/fairness-types";

/** "-4.0" / "+1.0" — the chip shown against every ledger row. */
export function formatPoints(points: number): string {
  const sign = points > 0 ? "+" : points < 0 ? "−" : "";
  return `${sign}${Math.abs(points).toFixed(1)}`;
}
