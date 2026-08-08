/**
 * What a run of months earns — and what it triggers.
 *
 * Pure: no Prisma, no clock. Two rules, evaluated at each month close.
 *
 * **Excellence streak.** Three consecutive months at 90 or above earns a badge
 * and a place on the owner's bonus-eligible list. Consecutive is the point:
 * one strong month is a good month, three is a standard.
 *
 * **Performance review.** Two of the last three months below 60 raises a flag
 * with the evidence attached. Two of three rather than two consecutive,
 * because the pattern that matters is instability, and a good month wedged
 * between two bad ones is not recovery.
 *
 * The asymmetry between them is deliberate. The bonus rewards a *sustained*
 * run; the review catches a *pattern*. Making both work the same way would
 * either make the bonus trivial or the review trigger-happy.
 */

export type MonthScore = {
  year: number;
  month: number;
  score: number;
  /** False for a month the member wasn't active — skipped, not counted. */
  active: boolean;
};

export type IncentiveConfig = {
  bonusThresholdScore: number;
  bonusStreakMonths: number;
  reviewThresholdScore: number;
  reviewWindowMonths: number;
  reviewTriggerCount: number;
};

export const DEFAULT_INCENTIVE_CONFIG: IncentiveConfig = {
  bonusThresholdScore: 90,
  bonusStreakMonths: 3,
  reviewThresholdScore: 60,
  reviewWindowMonths: 3,
  reviewTriggerCount: 2,
};

export type StreakState = {
  /** Consecutive qualifying months ending at the most recent one. */
  months: number;
  required: number;
  /** True the month the streak reaches its target. */
  earned: boolean;
  /** Months still to go. Zero once earned. */
  remaining: number;
  /** "2 of 3 months toward Excellence bonus" — shown to the member. */
  label: string;
};

/**
 * The streak, counted backwards from the most recent month.
 *
 * Inactive months are skipped rather than breaking the run: somebody on leave
 * for August did not fail August, and resetting their streak for it would
 * punish taking time off.
 */
export function excellenceStreak(
  months: readonly MonthScore[],
  config: IncentiveConfig = DEFAULT_INCENTIVE_CONFIG,
): StreakState {
  let count = 0;

  for (let index = months.length - 1; index >= 0; index -= 1) {
    const entry = months[index];
    if (!entry.active) continue;
    if (entry.score < config.bonusThresholdScore) break;
    count += 1;
  }

  const required = Math.max(1, config.bonusStreakMonths);
  const earned = count >= required;

  return {
    months: count,
    required,
    earned,
    remaining: Math.max(0, required - count),
    label: earned
      ? `${count} months at ${config.bonusThresholdScore}+ — Excellence bonus earned`
      : `${count} of ${required} months toward the Excellence bonus`,
  };
}

export type ReviewState = {
  /** Qualifying low months inside the window. */
  lowMonths: number;
  window: number;
  required: number;
  triggered: boolean;
  /** The months that count, newest first, for the evidence bundle. */
  offendingMonths: MonthScore[];
};

/**
 * Whether a performance review is due.
 *
 * Looks at the last N *active* months. A member with only one month of history
 * can never trigger one — a review off a single data point is a conversation
 * about noise.
 */
export function performanceReview(
  months: readonly MonthScore[],
  config: IncentiveConfig = DEFAULT_INCENTIVE_CONFIG,
): ReviewState {
  const active = months.filter((entry) => entry.active);
  const window = active.slice(-Math.max(1, config.reviewWindowMonths));
  const low = window.filter((entry) => entry.score < config.reviewThresholdScore);

  return {
    lowMonths: low.length,
    window: window.length,
    required: config.reviewTriggerCount,
    // Needs a full window's worth of history: two low months out of two is a
    // rough start, not an established pattern.
    triggered: window.length >= config.reviewWindowMonths && low.length >= config.reviewTriggerCount,
    offendingMonths: [...low].reverse(),
  };
}

// ---------------------------------------------------------------------------
// Dispute health
// ---------------------------------------------------------------------------

export type DisputeStats = {
  filed: number;
  reversed: number;
  upheld: number;
  open: number;
  /** Share of *decided* disputes that were reversed, as a percentage. */
  reversalRate: number | null;
  /** What the rate means, in words the owner can act on. */
  insight: string;
};

/**
 * What the month's disputes say about the rules.
 *
 * The reversal rate is a measurement of the *scoring system*, not of the
 * members filing. A high rate means the rules are producing charges that don't
 * survive scrutiny — and the honest response to that is to change the rules,
 * not to discourage disputes. The insight text says so explicitly, because a
 * bare percentage invites the opposite reading.
 */
export function disputeStats(input: {
  filed: number;
  reversed: number;
  upheld: number;
  open: number;
}): DisputeStats {
  const decided = input.reversed + input.upheld;
  const reversalRate = decided === 0 ? null : Math.round((input.reversed / decided) * 100);

  return {
    ...input,
    reversalRate,
    insight: disputeInsight(input.filed, decided, reversalRate),
  };
}

function disputeInsight(filed: number, decided: number, rate: number | null): string {
  if (filed === 0) {
    return "No disputes filed. Either the scoring is landing right, or people don't believe the process is worth using — worth asking.";
  }
  if (decided === 0) {
    return `${filed} filed and none decided yet.`;
  }
  if (rate === null) return `${filed} filed.`;

  if (rate >= 50) {
    return `${rate}% of decided disputes were reversed. That is a signal about the rules, not about the people filing — more than half of these charges didn't survive scrutiny, so the thresholds producing them need a look.`;
  }
  if (rate >= 25) {
    return `${rate}% reversed. Worth watching: if it keeps climbing, the rule producing those charges is mis-calibrated rather than the members being unlucky.`;
  }
  if (rate === 0) {
    return `${decided} decided, none reversed. Either the scoring is well calibrated, or challenges aren't getting a fair hearing — the answer is in the response notes.`;
  }
  return `${rate}% reversed, which is a healthy amount of correction.`;
}
