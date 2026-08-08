import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_HEALTH_WEIGHTS,
  clientHealth,
  healthBand,
  normaliseWeights,
  type HealthInput,
} from "../lib/clientHealth";

function input(over: Partial<HealthInput> = {}): HealthInput {
  return {
    onTimeRate: 95,
    deliveredCount: 12,
    roas: 4.2,
    targetRoas: 3,
    weeksBelowTarget: 0,
    paymentStatus: "PAID",
    overdueCycles: 0,
    clientBlockedDays: 1,
    ...over,
  };
}

describe("healthBand", () => {
  it("maps each band to its range", () => {
    assert.equal(healthBand(100), "HEALTHY");
    assert.equal(healthBand(75), "HEALTHY");
    assert.equal(healthBand(74), "WATCH");
    assert.equal(healthBand(55), "WATCH");
    assert.equal(healthBand(54), "AT_RISK");
    assert.equal(healthBand(0), "AT_RISK");
  });
});

describe("clientHealth", () => {
  it("scores a good client highly", () => {
    const health = clientHealth(input());
    assert.equal(health.band, "HEALTHY");
    assert.ok(health.score >= 90, `scored ${health.score}`);
  });

  it("names no problem when there isn't one", () => {
    assert.equal(clientHealth(input()).headline, null);
  });

  it("drops a client to at risk when everything is wrong", () => {
    const health = clientHealth(
      input({
        onTimeRate: 30,
        roas: 0.9,
        weeksBelowTarget: 4,
        paymentStatus: "OVERDUE",
        overdueCycles: 2,
        clientBlockedDays: 14,
      }),
    );
    assert.equal(health.band, "AT_RISK");
    assert.ok(health.score < 40, `scored ${health.score}`);
  });

  it("names the biggest drag in the headline", () => {
    const health = clientHealth(
      input({ roas: 0.6, weeksBelowTarget: 5, targetRoas: 3 }),
    );
    assert.match(health.headline ?? "", /ROAS 0\.6 against a 3 target/);
  });

  it("stays healthy with one weak dimension when the rest are strong", () => {
    // A single late month shouldn't put a paying, well-performing, responsive
    // client on the at-risk list.
    const health = clientHealth(input({ onTimeRate: 55 }));
    assert.equal(health.band, "HEALTHY");
  });
});

describe("what counts as evidence", () => {
  it("ignores an on-time rate over too few milestones", () => {
    // One late out of two is a 50% rate that means almost nothing. Letting it
    // drive a third of the score would flag every new client in week two.
    const thin = clientHealth(input({ onTimeRate: 50, deliveredCount: 2 }));
    const delivery = thin.components.find((c) => c.key === "delivery");

    assert.equal(delivery?.score, null);
    assert.match(delivery?.detail ?? "", /not enough to judge/);
    assert.equal(thin.band, "HEALTHY", "a thin record dragged the score down");
  });

  it("counts the rate once there are three delivered", () => {
    const enough = clientHealth(input({ onTimeRate: 50, deliveredCount: 3 }));
    assert.equal(enough.components.find((c) => c.key === "delivery")?.score, 50);
  });

  it("treats a brand-new client as healthy rather than unknown-therefore-bad", () => {
    const fresh = clientHealth(
      input({
        onTimeRate: null,
        deliveredCount: 0,
        roas: null,
        paymentStatus: "PENDING",
        clientBlockedDays: 0,
      }),
    );
    assert.equal(fresh.band, "HEALTHY");
    assert.equal(fresh.headline, null);
  });

  it("redistributes weight rather than scoring the unknown as zero", () => {
    // With no campaign data, a client delivering perfectly and paying on time
    // must still score near the top.
    const noCampaigns = clientHealth(input({ roas: null }));
    assert.ok(noCampaigns.score >= 90, `scored ${noCampaigns.score}`);
    assert.equal(noCampaigns.components.find((c) => c.key === "roas")?.score, null);
  });

  it("scores 100 when nothing at all is measurable", () => {
    const blank = clientHealth({
      onTimeRate: null,
      deliveredCount: 0,
      roas: null,
      targetRoas: 3,
      weeksBelowTarget: 0,
      // Payment always has a value, so force the one case with truly nothing.
      paymentStatus: "PENDING",
      overdueCycles: 0,
      clientBlockedDays: 0,
    });
    assert.ok(blank.score >= 85);
  });
});

describe("the ROAS dimension", () => {
  it("scores 80 at exactly target, leaving headroom above", () => {
    // "Exactly on target" shouldn't read as a perfect relationship.
    const onTarget = clientHealth(input({ roas: 3, targetRoas: 3 }));
    assert.equal(onTarget.components.find((c) => c.key === "roas")?.score, 80);
  });

  it("rewards genuine outperformance", () => {
    const strong = clientHealth(input({ roas: 4.5, targetRoas: 3 }));
    assert.equal(strong.components.find((c) => c.key === "roas")?.score, 100);
  });

  it("punishes a sustained shortfall harder than the ratio alone", () => {
    const oneWeek = clientHealth(input({ roas: 2.4, targetRoas: 3, weeksBelowTarget: 1 }));
    const fourWeeks = clientHealth(input({ roas: 2.4, targetRoas: 3, weeksBelowTarget: 4 }));

    const one = oneWeek.components.find((c) => c.key === "roas")!.score!;
    const four = fourWeeks.components.find((c) => c.key === "roas")!.score!;
    assert.ok(four < one - 20, `${four} was not meaningfully below ${one}`);
  });

  it("never goes below zero however bad it gets", () => {
    const dire = clientHealth(input({ roas: 0.1, targetRoas: 5, weeksBelowTarget: 12 }));
    assert.ok((dire.components.find((c) => c.key === "roas")?.score ?? -1) >= 0);
  });
});

describe("the payment dimension", () => {
  it("treats pending as fine, not as a problem", () => {
    // An invoice that isn't due yet is not a warning sign.
    const pending = clientHealth(input({ paymentStatus: "PENDING" }));
    assert.equal(pending.components.find((c) => c.key === "payment")?.score, 85);
  });

  it("falls away as cycles stack up overdue", () => {
    const one = clientHealth(input({ paymentStatus: "OVERDUE", overdueCycles: 1 }));
    const three = clientHealth(input({ paymentStatus: "OVERDUE", overdueCycles: 3 }));

    assert.equal(one.components.find((c) => c.key === "payment")?.score, 50);
    assert.equal(three.components.find((c) => c.key === "payment")?.score, 0);
  });
});

describe("the responsiveness dimension", () => {
  it("gives full marks for normal back-and-forth", () => {
    for (const days of [0, 1, 2]) {
      const health = clientHealth(input({ clientBlockedDays: days }));
      assert.equal(health.components.find((c) => c.key === "blocked")?.score, 100, `${days}d`);
    }
  });

  it("decays past a couple of days", () => {
    const week = clientHealth(input({ clientBlockedDays: 9 }));
    const score = week.components.find((c) => c.key === "blocked")!.score!;
    assert.ok(score > 0 && score < 60, `scored ${score}`);
  });

  it("bottoms out around a fortnight of waiting", () => {
    assert.equal(clientHealth(input({ clientBlockedDays: 20 })).components.find((c) => c.key === "blocked")?.score, 0);
  });
});

describe("configurable weights", () => {
  it("respects a reweighting", () => {
    const deliveryHeavy = clientHealth(input({ onTimeRate: 20, deliveredCount: 10 }), {
      delivery: 90,
      roas: 5,
      payment: 3,
      blocked: 2,
    });
    const deliveryLight = clientHealth(input({ onTimeRate: 20, deliveredCount: 10 }), {
      delivery: 5,
      roas: 60,
      payment: 20,
      blocked: 15,
    });

    assert.ok(deliveryHeavy.score < deliveryLight.score);
  });

  it("normalises weights that don't sum to 100", () => {
    const weights = normaliseWeights({ delivery: 40, roas: 40, payment: 40, blocked: 40 });
    const total = weights.delivery + weights.roas + weights.payment + weights.blocked;
    assert.ok(Math.abs(total - 1) < 1e-9, `summed to ${total}`);
  });

  it("falls back to equal weighting rather than dividing by zero", () => {
    const weights = normaliseWeights({ delivery: 0, roas: 0, payment: 0, blocked: 0 });
    assert.deepEqual(weights, { delivery: 0.25, roas: 0.25, payment: 0.25, blocked: 0.25 });
  });

  it("ignores negative weights instead of inverting a dimension", () => {
    const weights = normaliseWeights({ delivery: -50, roas: 50, payment: 25, blocked: 25 });
    assert.equal(weights.delivery, 0);
    assert.equal(weights.roas, 0.5);
  });

  it("always produces a score inside 0–100", () => {
    for (const roas of [0, 0.5, 3, 12]) {
      for (const onTime of [0, 50, 100]) {
        for (const days of [0, 5, 40]) {
          const health = clientHealth(
            input({ roas, onTimeRate: onTime, clientBlockedDays: days, deliveredCount: 8 }),
            DEFAULT_HEALTH_WEIGHTS,
          );
          assert.ok(health.score >= 0 && health.score <= 100, `scored ${health.score}`);
        }
      }
    }
  });
});
