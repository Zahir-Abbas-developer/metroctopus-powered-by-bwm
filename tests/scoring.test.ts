import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  EARLY_BONUS_POINTS,
  MONTHLY_BASELINE,
  clampScore,
  dedupeKeyFor,
  earlyBonus,
  evaluateCompletion,
  evaluateMissed,
  formatPoints,
  lateDeduction,
  missedDeduction,
  monthlyScore,
  qualifiesForEarlyBonus,
  rejectionDeduction,
  rejectionEvent,
  scoreBand,
  type MilestoneFacts,
} from "../lib/scoring";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Deadline used across the suite: midnight Karachi on 15 Aug 2026. */
const DEADLINE = new Date("2026-08-14T19:00:00.000Z");

function facts(overrides: Partial<MilestoneFacts> = {}): MilestoneFacts {
  return {
    id: "m1",
    title: "Campaign structure & launch",
    weight: 4,
    deadline: DEADLINE,
    completedAt: null,
    assigneeId: "u1",
    ...overrides,
  };
}

describe("lateDeduction", () => {
  it("charges nothing when delivered before the deadline", () => {
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() - HOUR)), 0);
  });

  it("charges nothing when delivered exactly on the deadline", () => {
    assert.equal(lateDeduction(4, DEADLINE, DEADLINE), 0);
  });

  it("charges weight x 1 the moment it is late at all", () => {
    // One minute late is still late: the base charge applies in full.
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 60_000)), -4);
    assert.equal(lateDeduction(1, DEADLINE, new Date(DEADLINE.getTime() + 60_000)), -1);
  });

  it("adds 0.5 x weight for each additional full 24h", () => {
    // 25h late = base + one complete extra day.
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 25 * HOUR)), -6);
    // Exactly 24h late already counts as one complete extra day.
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + DAY)), -6);
    // 3 days late: 4 + 3 x 2 = 10, still under the cap of 12.
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 3 * DAY)), -10);
  });

  it("never exceeds the weight x 3 cap, however late it gets", () => {
    // The cap binds from four complete days late onward: w + 0.5w*4 = 3w.
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 4 * DAY)), -12);
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 10 * DAY)), -12);
    assert.equal(lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 400 * DAY)), -12);
    // And it holds at both ends of the weight range.
    assert.equal(lateDeduction(1, DEADLINE, new Date(DEADLINE.getTime() + 30 * DAY)), -3);
    assert.equal(lateDeduction(5, DEADLINE, new Date(DEADLINE.getTime() + 30 * DAY)), -15);
  });

  it("only ever produces multiples of 0.5", () => {
    for (let weight = 1; weight <= 5; weight += 1) {
      for (let days = 0; days <= 8; days += 1) {
        const points = lateDeduction(weight, DEADLINE, new Date(DEADLINE.getTime() + days * DAY + HOUR));
        assert.equal(points * 2, Math.round(points * 2), `weight ${weight}, ${days}d`);
      }
    }
  });
});

describe("missedDeduction", () => {
  it("charges weight x 4", () => {
    assert.equal(missedDeduction(1), -4);
    assert.equal(missedDeduction(3), -12);
    assert.equal(missedDeduction(5), -20);
  });

  it("costs more than the worst possible late charge, at every weight", () => {
    // Otherwise abandoning work would be cheaper than finishing it late.
    for (let weight = 1; weight <= 5; weight += 1) {
      const worstLate = lateDeduction(weight, DEADLINE, new Date(DEADLINE.getTime() + 99 * DAY));
      assert.ok(missedDeduction(weight) < worstLate, `weight ${weight}`);
    }
  });
});

describe("rejectionDeduction", () => {
  it("charges weight x 0.5", () => {
    assert.equal(rejectionDeduction(1), -0.5);
    assert.equal(rejectionDeduction(4), -2);
    assert.equal(rejectionDeduction(5), -2.5);
  });

  it("stacks on every rejection", () => {
    const three = [rejectionDeduction(4), rejectionDeduction(4), rejectionDeduction(4)];
    assert.equal(monthlyScore(three), 94);
  });
});

describe("earlyBonus", () => {
  it("pays +1 when delivered a full day or more early", () => {
    assert.equal(earlyBonus(DEADLINE, new Date(DEADLINE.getTime() - DAY)), EARLY_BONUS_POINTS);
    assert.equal(earlyBonus(DEADLINE, new Date(DEADLINE.getTime() - 5 * DAY)), EARLY_BONUS_POINTS);
  });

  it("pays nothing inside the final 24h", () => {
    assert.equal(earlyBonus(DEADLINE, new Date(DEADLINE.getTime() - DAY + 1)), 0);
    assert.equal(earlyBonus(DEADLINE, new Date(DEADLINE.getTime() - HOUR)), 0);
    assert.equal(earlyBonus(DEADLINE, DEADLINE), 0);
  });

  it("pays nothing when late", () => {
    assert.equal(earlyBonus(DEADLINE, new Date(DEADLINE.getTime() + HOUR)), 0);
  });

  it("qualifiesForEarlyBonus agrees with earlyBonus", () => {
    const at = new Date(DEADLINE.getTime() - DAY);
    assert.equal(qualifiesForEarlyBonus(DEADLINE, at), earlyBonus(DEADLINE, at) > 0);
  });
});

describe("monthlyScore", () => {
  it("starts every member at 100", () => {
    assert.equal(monthlyScore([]), MONTHLY_BASELINE);
  });

  it("is the baseline plus the month's events", () => {
    assert.equal(monthlyScore([-4, -2, 1]), 95);
  });

  it("clamps at 100 so bonuses cannot inflate a score", () => {
    assert.equal(monthlyScore([1, 1, 1, 1, 1]), 100);
    assert.equal(monthlyScore([-2, 1, 1, 1, 1, 1]), 100);
  });

  it("clamps at 0 rather than going negative", () => {
    assert.equal(monthlyScore([-20, -20, -20, -20, -20, -20]), 0);
    assert.equal(monthlyScore([-999]), 0);
  });

  it("does not drift when summing many half-point events", () => {
    const events = Array.from({ length: 40 }, () => -0.5);
    assert.equal(monthlyScore(events), 80);
  });
});

describe("scoreBand", () => {
  it("maps each band to its range", () => {
    assert.equal(scoreBand(100).key, "EXCELLENT");
    assert.equal(scoreBand(90).key, "EXCELLENT");
    assert.equal(scoreBand(89.5).key, "GOOD");
    assert.equal(scoreBand(75).key, "GOOD");
    assert.equal(scoreBand(74).key, "ATTENTION");
    assert.equal(scoreBand(60).key, "ATTENTION");
    assert.equal(scoreBand(59).key, "CRITICAL");
    assert.equal(scoreBand(0).key, "CRITICAL");
  });

  it("uses only palette colours", () => {
    const palette = new Set(["#1A6B3A", "#1A4FA0", "#C4730A", "#C0392B"]);
    for (const score of [100, 80, 65, 20]) {
      assert.ok(palette.has(scoreBand(score).color), `score ${score}`);
    }
  });

  it("clamps out-of-range input rather than returning undefined", () => {
    assert.equal(scoreBand(140).key, "EXCELLENT");
    assert.equal(scoreBand(-40).key, "CRITICAL");
  });
});

describe("clampScore", () => {
  it("bounds to 0..100", () => {
    assert.equal(clampScore(-5), 0);
    assert.equal(clampScore(105), 100);
    assert.equal(clampScore(72), 72);
  });
});

describe("evaluateCompletion", () => {
  it("proposes a LATE event for a late delivery", () => {
    const [event] = evaluateCompletion(
      facts({ completedAt: new Date(DEADLINE.getTime() + 25 * HOUR) }),
    );
    assert.equal(event.type, "LATE");
    assert.equal(event.points, -6);
    assert.equal(event.userId, "u1");
    assert.equal(event.dedupeKey, "m1:LATE");
    assert.match(event.reason, /1 day/);
  });

  it("proposes an EARLY_BONUS for an early delivery", () => {
    const [event] = evaluateCompletion(
      facts({ completedAt: new Date(DEADLINE.getTime() - 2 * DAY) }),
    );
    assert.equal(event.type, "EARLY_BONUS");
    assert.equal(event.points, 1);
    assert.equal(event.dedupeKey, "m1:EARLY_BONUS");
  });

  it("proposes nothing for an on-time delivery inside the final day", () => {
    const events = evaluateCompletion(
      facts({ completedAt: new Date(DEADLINE.getTime() - 2 * HOUR) }),
    );
    assert.deepEqual(events, []);
  });

  it("proposes nothing when the milestone is unassigned", () => {
    const events = evaluateCompletion(
      facts({ assigneeId: null, completedAt: new Date(DEADLINE.getTime() + DAY) }),
    );
    assert.deepEqual(events, []);
  });

  it("proposes nothing when the milestone is not actually complete", () => {
    assert.deepEqual(evaluateCompletion(facts({ completedAt: null })), []);
  });

  it("is idempotent: re-evaluating an already-charged milestone proposes nothing", () => {
    const milestone = facts({ completedAt: new Date(DEADLINE.getTime() + 25 * HOUR) });

    const first = evaluateCompletion(milestone);
    assert.equal(first.length, 1);

    // Second pass, with the first run's key already in the ledger.
    const applied = new Set(first.map((event) => event.dedupeKey!));
    assert.deepEqual(evaluateCompletion(milestone, applied), []);

    // And a third, to be sure the set is read rather than mutated.
    assert.deepEqual(evaluateCompletion(milestone, applied), []);
  });

  it("is idempotent for bonuses too", () => {
    const milestone = facts({ completedAt: new Date(DEADLINE.getTime() - 3 * DAY) });
    const first = evaluateCompletion(milestone);
    const applied = new Set(first.map((event) => event.dedupeKey!));
    assert.deepEqual(evaluateCompletion(milestone, applied), []);
  });
});

describe("evaluateMissed", () => {
  it("charges weight x 4 for an unfinished milestone", () => {
    const [event] = evaluateMissed(facts({ weight: 3 }));
    assert.equal(event.type, "MISSED");
    assert.equal(event.points, -12);
    assert.equal(event.dedupeKey, "m1:MISSED");
  });

  it("does not charge a milestone that was completed, however late", () => {
    const events = evaluateMissed(
      facts({ completedAt: new Date(DEADLINE.getTime() + 10 * DAY) }),
    );
    assert.deepEqual(events, []);
  });

  it("does not charge an unassigned milestone to nobody", () => {
    assert.deepEqual(evaluateMissed(facts({ assigneeId: null })), []);
  });

  it("is idempotent across repeated evaluation runs", () => {
    const milestone = facts();
    const first = evaluateMissed(milestone);
    const applied = new Set(first.map((event) => event.dedupeKey!));

    assert.deepEqual(evaluateMissed(milestone, applied), []);
    assert.deepEqual(evaluateMissed(milestone, applied), []);
  });

  it("charges LATE and MISSED under different keys so neither blocks the other", () => {
    assert.notEqual(dedupeKeyFor("m1", "LATE"), dedupeKeyFor("m1", "MISSED"));
  });
});

describe("rejectionEvent", () => {
  it("carries no dedupe key, so repeat rejections all count", () => {
    const event = rejectionEvent(
      { id: "m1", title: "Landing page", weight: 4, assigneeId: "u1" },
      "Copy does not match the approved brief",
    );
    assert.equal(event?.dedupeKey, null);
    assert.equal(event?.points, -2);
    assert.match(event!.reason, /approved brief/);
  });

  it("returns null when nobody is assigned", () => {
    assert.equal(
      rejectionEvent({ id: "m1", title: "x", weight: 4, assigneeId: null }, "why"),
      null,
    );
  });
});

describe("a full month, end to end", () => {
  it("adds up the way the spec describes", () => {
    const points = [
      lateDeduction(4, DEADLINE, new Date(DEADLINE.getTime() + 2 * HOUR)), // -4
      rejectionDeduction(2), //                                               -1
      earlyBonus(DEADLINE, new Date(DEADLINE.getTime() - 2 * DAY)), //         +1
      missedDeduction(3), //                                                 -12
    ];
    assert.deepEqual(points, [-4, -1, 1, -12]);
    assert.equal(monthlyScore(points), 84);
    assert.equal(scoreBand(monthlyScore(points)).key, "GOOD");
  });
});

describe("formatPoints", () => {
  it("renders signed chips to one decimal", () => {
    assert.equal(formatPoints(-4), "−4.0");
    assert.equal(formatPoints(1), "+1.0");
    assert.equal(formatPoints(-0.5), "−0.5");
    assert.equal(formatPoints(0), "0.0");
  });
});
