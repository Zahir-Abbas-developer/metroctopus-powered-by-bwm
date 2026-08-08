import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_INCENTIVE_CONFIG,
  disputeStats,
  excellenceStreak,
  performanceReview,
  type MonthScore,
} from "../lib/incentives";

/** Months oldest-first, as the evaluators expect. */
function months(scores: (number | null)[]): MonthScore[] {
  return scores.map((score, index) => ({
    year: 2026,
    month: index + 1,
    score: score ?? 0,
    active: score !== null,
  }));
}

describe("excellenceStreak", () => {
  it("earns the badge on the third consecutive qualifying month", () => {
    const streak = excellenceStreak(months([92, 95, 91]));
    assert.equal(streak.months, 3);
    assert.equal(streak.earned, true);
    assert.match(streak.label, /Excellence bonus earned/);
  });

  it("counts backwards from the most recent month", () => {
    // A great run that ended two months ago is not a current streak.
    const streak = excellenceStreak(months([95, 95, 95, 70, 92]));
    assert.equal(streak.months, 1);
    assert.equal(streak.earned, false);
  });

  it("shows progress before the badge is earned", () => {
    const streak = excellenceStreak(months([70, 91, 93]));
    assert.equal(streak.months, 2);
    assert.equal(streak.remaining, 1);
    assert.equal(streak.label, "2 of 3 months toward the Excellence bonus");
  });

  it("treats exactly the threshold as qualifying", () => {
    assert.equal(excellenceStreak(months([90, 90, 90])).earned, true);
    assert.equal(excellenceStreak(months([90, 89.5, 90])).months, 1);
  });

  it("skips an inactive month rather than breaking the run", () => {
    // Somebody on leave for August did not fail August, and resetting their
    // streak for it would punish taking time off.
    const streak = excellenceStreak(months([92, null, 94, 91]));
    assert.equal(streak.months, 3);
    assert.equal(streak.earned, true);
  });

  it("keeps counting past the required run", () => {
    const streak = excellenceStreak(months([95, 95, 95, 95, 95]));
    assert.equal(streak.months, 5);
    assert.equal(streak.remaining, 0);
  });

  it("is zero for a member with no history", () => {
    const streak = excellenceStreak([]);
    assert.equal(streak.months, 0);
    assert.equal(streak.earned, false);
  });

  it("is zero when every month is inactive", () => {
    assert.equal(excellenceStreak(months([null, null])).months, 0);
  });

  it("honours a reconfigured threshold and length", () => {
    const strict = { ...DEFAULT_INCENTIVE_CONFIG, bonusThresholdScore: 95, bonusStreakMonths: 2 };
    assert.equal(excellenceStreak(months([96, 97]), strict).earned, true);
    assert.equal(excellenceStreak(months([96, 94]), strict).earned, false);
  });
});

describe("performanceReview", () => {
  it("triggers on two low months out of three", () => {
    const review = performanceReview(months([55, 80, 52]));
    assert.equal(review.triggered, true);
    assert.equal(review.lowMonths, 2);
  });

  it("triggers on two consecutive low months too", () => {
    assert.equal(performanceReview(months([80, 55, 52])).triggered, true);
  });

  it("does not trigger on a single bad month", () => {
    assert.equal(performanceReview(months([80, 85, 52])).triggered, false);
  });

  it("only looks at the window, not all history", () => {
    // Two bad months from six months ago are not a current pattern.
    assert.equal(performanceReview(months([40, 42, 88, 90, 91])).triggered, false);
  });

  it("needs a full window of history before it can fire", () => {
    // Two low months out of two is a rough start, not an established pattern.
    assert.equal(performanceReview(months([40, 45])).triggered, false);
    assert.equal(performanceReview(months([40, 45, 90])).triggered, true);
  });

  it("treats exactly the threshold as acceptable", () => {
    assert.equal(performanceReview(months([60, 60, 60])).triggered, false);
    assert.equal(performanceReview(months([59, 59, 90])).triggered, true);
  });

  it("skips inactive months when sizing the window", () => {
    const review = performanceReview(months([50, null, 52, 90]));
    assert.equal(review.window, 3);
    assert.equal(review.lowMonths, 2);
    assert.equal(review.triggered, true);
  });

  it("returns the offending months newest first, for the evidence bundle", () => {
    const review = performanceReview(months([55, 80, 52]));
    assert.deepEqual(
      review.offendingMonths.map((entry) => entry.month),
      [3, 1],
    );
  });

  it("never triggers for a member with no history", () => {
    assert.equal(performanceReview([]).triggered, false);
  });
});

describe("the two rules read differently on purpose", () => {
  it("a bonus needs a consecutive run; a review needs only a pattern", () => {
    // 92, 55, 91: the streak resets, but two of three aren't low either.
    const mixed = months([92, 55, 91]);
    assert.equal(excellenceStreak(mixed).earned, false);
    assert.equal(performanceReview(mixed).triggered, false);

    // 55, 91, 52: no streak, and the pattern does fire.
    const unstable = months([55, 91, 52]);
    assert.equal(excellenceStreak(unstable).earned, false);
    assert.equal(performanceReview(unstable).triggered, true);
  });

  it("a member can never be both bonus-eligible and under review", () => {
    for (const scores of [
      [95, 95, 95],
      [55, 55, 55],
      [90, 90, 90],
      [92, 45, 91],
      [59, 91, 59],
    ]) {
      const entries = months(scores);
      const both = excellenceStreak(entries).earned && performanceReview(entries).triggered;
      assert.equal(both, false, scores.join(","));
    }
  });
});

describe("disputeStats", () => {
  it("reports a reversal rate over decided disputes only", () => {
    // Open disputes have no outcome yet; counting them would drag the rate
    // towards zero simply because the owner is slow.
    const stats = disputeStats({ filed: 10, reversed: 2, upheld: 6, open: 2 });
    assert.equal(stats.reversalRate, 25);
  });

  it("has no rate before anything is decided", () => {
    const stats = disputeStats({ filed: 3, reversed: 0, upheld: 0, open: 3 });
    assert.equal(stats.reversalRate, null);
    assert.match(stats.insight, /none decided yet/);
  });

  it("says a high rate is about the rules, not the people", () => {
    const stats = disputeStats({ filed: 8, reversed: 5, upheld: 3, open: 0 });
    assert.equal(stats.reversalRate, 63);
    assert.match(stats.insight, /signal about the rules, not about the people/);
    assert.match(stats.insight, /need a look/);
  });

  it("flags a climbing rate before it becomes a crisis", () => {
    const stats = disputeStats({ filed: 8, reversed: 3, upheld: 5, open: 0 });
    assert.match(stats.insight, /mis-calibrated/);
  });

  it("questions a zero rate rather than celebrating it", () => {
    // Nothing reversed could mean well-calibrated scoring, or challenges not
    // getting a fair hearing. The insight says both.
    const stats = disputeStats({ filed: 6, reversed: 0, upheld: 6, open: 0 });
    assert.match(stats.insight, /aren't getting a fair hearing/);
  });

  it("questions silence rather than treating it as success", () => {
    const stats = disputeStats({ filed: 0, reversed: 0, upheld: 0, open: 0 });
    assert.match(stats.insight, /don't believe the process is worth using/);
  });

  it("calls a moderate rate healthy", () => {
    const stats = disputeStats({ filed: 10, reversed: 1, upheld: 9, open: 0 });
    assert.match(stats.insight, /healthy amount of correction/);
  });
});
