import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TARGET_CONFIG,
  describeProgress,
  evaluateTarget,
  evaluateWeek,
  targetTone,
} from "../lib/targets";
import { bucketFor, ACTIVITY_TYPES } from "../lib/pipeline-types";

describe("bucketFor", () => {
  it("counts calls, emails and DMs as one outreach number", () => {
    assert.equal(bucketFor("CALL"), "OUTREACH");
    assert.equal(bucketFor("EMAIL"), "OUTREACH");
    assert.equal(bucketFor("DM"), "OUTREACH");
  });

  it("keeps follow-ups, proposals and meetings separate", () => {
    assert.equal(bucketFor("FOLLOW_UP"), "FOLLOW_UP");
    assert.equal(bucketFor("PROPOSAL_SENT"), "PROPOSAL");
    assert.equal(bucketFor("MEETING"), "MEETING");
  });

  it("maps every activity type to some bucket", () => {
    for (const type of ACTIVITY_TYPES) {
      assert.notEqual(bucketFor(type), null, type);
    }
  });

  it("returns null for anything that isn't an activity", () => {
    assert.equal(bucketFor("LUNCH"), null);
  });
});

describe("evaluateTarget", () => {
  it("is met at exactly the target", () => {
    const progress = evaluateTarget("OUTREACH", 40, 40);
    assert.equal(progress.met, true);
    assert.equal(progress.missed, false);
    assert.equal(progress.percent, 100);
  });

  it("is met above the target, and the ratio keeps the overshoot", () => {
    const progress = evaluateTarget("OUTREACH", 40, 52);
    assert.equal(progress.met, true);
    assert.equal(progress.ratio, 1.3);
    // The bar caps at 100 even though the ratio doesn't.
    assert.equal(progress.percent, 100);
  });

  it("is neither met nor missed in the band between", () => {
    // 30 of 40 is 75% — short of the target, but well above the 60% floor.
    const progress = evaluateTarget("OUTREACH", 40, 30);
    assert.equal(progress.met, false);
    assert.equal(progress.missed, false);
  });

  it("is missed below the threshold", () => {
    const progress = evaluateTarget("OUTREACH", 40, 23);
    assert.equal(progress.missed, true);
  });

  it("treats exactly the threshold as not missed", () => {
    // 24 of 40 is exactly 60%. The charge applies *below* the line.
    assert.equal(evaluateTarget("OUTREACH", 40, 24).missed, false);
    assert.equal(evaluateTarget("OUTREACH", 40, 23.99).missed, true);
  });

  it("treats a target of zero as unset rather than instantly met", () => {
    // Otherwise every member would earn a point a week for a bucket nobody
    // asked them to work.
    const progress = evaluateTarget("MEETING", 0, 0);
    assert.equal(progress.met, false);
    assert.equal(progress.missed, false);
  });

  it("never reports a miss for a bucket with no target, however little was done", () => {
    assert.equal(evaluateTarget("MEETING", 0, 0).missed, false);
  });
});

describe("evaluateWeek", () => {
  const targets = [
    { bucket: "OUTREACH" as const, weeklyTarget: 40 },
    { bucket: "FOLLOW_UP" as const, weeklyTarget: 8 },
    { bucket: "PROPOSAL" as const, weeklyTarget: 3 },
  ];

  it("pays a point for each target met", () => {
    const outcome = evaluateWeek(targets, { OUTREACH: 42, FOLLOW_UP: 9, PROPOSAL: 3 });
    assert.equal(outcome.metCount, 3);
    assert.equal(outcome.missedCount, 0);
    assert.equal(outcome.points, 3);
  });

  it("charges a point for each target below the threshold", () => {
    const outcome = evaluateWeek(targets, { OUTREACH: 10, FOLLOW_UP: 1, PROPOSAL: 0 });
    assert.equal(outcome.metCount, 0);
    assert.equal(outcome.missedCount, 3);
    assert.equal(outcome.points, -3);
  });

  it("nets a mixed week out", () => {
    // Outreach smashed, follow-ups short but respectable, proposals missed.
    const outcome = evaluateWeek(targets, { OUTREACH: 55, FOLLOW_UP: 6, PROPOSAL: 1 });
    assert.equal(outcome.metCount, 1);
    assert.equal(outcome.missedCount, 1);
    assert.equal(outcome.points, 0);
  });

  it("costs nothing for a near miss", () => {
    // 38 of 40 and 7 of 8 is a good week that hit neither number exactly.
    const outcome = evaluateWeek(targets, { OUTREACH: 38, FOLLOW_UP: 7, PROPOSAL: 2 });
    assert.equal(outcome.points, 0, "a near miss was charged");
  });

  it("counts a bucket with no logged activity as zero, not as absent", () => {
    const outcome = evaluateWeek(targets, { OUTREACH: 40 });
    assert.equal(outcome.metCount, 1);
    assert.equal(outcome.missedCount, 2);
  });

  it("is a no-op for a member with no targets", () => {
    const outcome = evaluateWeek([], { OUTREACH: 99 });
    assert.deepEqual(outcome.progress, []);
    assert.equal(outcome.points, 0);
  });

  it("honours a reconfigured threshold and point values", () => {
    const strict = { bonusTargetMet: 2, penaltyTargetMissed: 0.5, missThreshold: 0.9 };
    const outcome = evaluateWeek(targets, { OUTREACH: 40, FOLLOW_UP: 7, PROPOSAL: 3 }, strict);
    // Outreach and proposals met (+2 each); follow-ups at 87.5% now miss (−0.5).
    assert.equal(outcome.metCount, 2);
    assert.equal(outcome.missedCount, 1);
    assert.equal(outcome.points, 3.5);
  });

  it("only ever produces multiples of 0.5 with the default config", () => {
    for (let logged = 0; logged <= 50; logged += 1) {
      const outcome = evaluateWeek(targets, { OUTREACH: logged });
      assert.equal(outcome.points * 2, Math.round(outcome.points * 2), `logged ${logged}`);
    }
  });
});

describe("targetTone", () => {
  it("colours by how the week is going", () => {
    assert.equal(targetTone(evaluateTarget("OUTREACH", 40, 40)), "success");
    assert.equal(targetTone(evaluateTarget("OUTREACH", 40, 30)), "warning");
    assert.equal(targetTone(evaluateTarget("OUTREACH", 40, 10)), "danger");
    assert.equal(targetTone(evaluateTarget("OUTREACH", 0, 0)), "neutral");
  });

  it("agrees with the miss flag at the boundary", () => {
    const config = DEFAULT_TARGET_CONFIG;
    for (let logged = 0; logged <= 40; logged += 1) {
      const progress = evaluateTarget("OUTREACH", 40, logged, config);
      assert.equal(
        targetTone(progress, config) === "danger",
        progress.missed,
        `logged ${logged}`,
      );
    }
  });
});

describe("describeProgress", () => {
  it("reads as information mid-week, not as an accusation", () => {
    assert.equal(describeProgress(evaluateTarget("OUTREACH", 40, 12)), "12 of 40");
  });

  it("says so once the target is met", () => {
    assert.equal(
      describeProgress(evaluateTarget("OUTREACH", 40, 41)),
      "41 of 40 — target met",
    );
  });

  it("says nothing about a bucket with no target", () => {
    assert.equal(describeProgress(evaluateTarget("MEETING", 0, 4)), "No target set");
  });
});
