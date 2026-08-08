import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  consecutiveWeeksBelow,
  deriveWeek,
  roasAlert,
  summarise,
  trend,
  weekStartOf,
} from "../lib/kpi";

const AT = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function week(over: Partial<Parameters<typeof deriveWeek>[0]> = {}) {
  return deriveWeek({
    weekStart: AT("2026-08-03"),
    googleSpend: 1200,
    metaSpend: 800,
    revenue: 8000,
    orders: 80,
    storeSessions: 4000,
    ...over,
  });
}

describe("deriveWeek", () => {
  it("computes the ratios from the columns beside them", () => {
    const derived = week();
    assert.equal(derived.spend, 2000);
    assert.equal(derived.roas, 4);
    assert.equal(derived.conversionRate, 2);
    assert.equal(derived.averageOrderValue, 100);
    assert.equal(derived.costPerOrder, 25);
  });

  it("reports no ROAS rather than zero when nothing was spent", () => {
    // A paused week has no ROAS. Reporting 0.0 would put it below every target
    // and fire an alert about a week nobody ran ads in.
    const paused = week({ googleSpend: 0, metaSpend: 0, revenue: 400 });
    assert.equal(paused.roas, null);
  });

  it("reports no conversion rate without sessions", () => {
    assert.equal(week({ storeSessions: 0 }).conversionRate, null);
  });

  it("reports no order metrics without orders", () => {
    const empty = week({ orders: 0 });
    assert.equal(empty.averageOrderValue, null);
    assert.equal(empty.costPerOrder, null);
  });

  it("rounds to two places rather than carrying a float tail", () => {
    const awkward = week({ googleSpend: 300, metaSpend: 0, revenue: 1000 });
    assert.equal(awkward.roas, 3.33);
  });

  it("survives a week where everything is zero", () => {
    const blank = deriveWeek({
      weekStart: AT("2026-08-03"),
      googleSpend: 0,
      metaSpend: 0,
      revenue: 0,
      orders: 0,
      storeSessions: 0,
    });
    assert.equal(blank.roas, null);
    assert.equal(blank.conversionRate, null);
    assert.equal(blank.spend, 0);
  });
});

describe("trend", () => {
  it("reports an improvement", () => {
    assert.deepEqual(trend(4.2, 3.5), { delta: 0.7, deltaPercent: 20, direction: "up" });
  });

  it("reports a decline", () => {
    const moved = trend(2.8, 3.5);
    assert.equal(moved.direction, "down");
    assert.equal(moved.delta, -0.7);
  });

  it("reports flat when nothing moved", () => {
    assert.equal(trend(3.5, 3.5).direction, "flat");
  });

  it("is unknown rather than flat with nothing to compare to", () => {
    // A first week of data is not a flat trend, and drawing it as one implies
    // a stability nobody has observed.
    assert.equal(trend(3.5, null).direction, "unknown");
    assert.equal(trend(null, 3.5).direction, "unknown");
  });

  it("gives no percentage when the baseline was zero", () => {
    assert.equal(trend(500, 0).deltaPercent, null);
  });
});

describe("consecutiveWeeksBelow", () => {
  const weeks = (roas: (number | null)[]) => roas.map((value) => ({ roas: value }));

  it("counts backwards from the latest week", () => {
    assert.equal(consecutiveWeeksBelow(weeks([4, 4, 2.1, 1.8]), 3), 2);
  });

  it("is zero when the latest week met the target", () => {
    assert.equal(consecutiveWeeksBelow(weeks([1.2, 1.5, 3.4]), 3), 0);
  });

  it("stops at the first week that met it, ignoring older dips", () => {
    assert.equal(consecutiveWeeksBelow(weeks([1, 1, 1, 5, 2]), 3), 1);
  });

  it("treats exactly on target as met, not below", () => {
    assert.equal(consecutiveWeeksBelow(weeks([3, 3]), 3), 0);
  });

  it("breaks the streak on a week with no spend", () => {
    // The client paused; they didn't underperform. Counting it would let a
    // holiday shutdown fire a performance alert.
    assert.equal(consecutiveWeeksBelow(weeks([1, 1, null, 2]), 3), 1);
  });

  it("is zero for a client with no data", () => {
    assert.equal(consecutiveWeeksBelow([], 3), 0);
  });
});

describe("roasAlert", () => {
  const weeks = (roas: (number | null)[]) => roas.map((value) => ({ roas: value }));

  it("does not fire on a single bad week", () => {
    // One bad week is noise — a creative refresh, a stock-out, a holiday. An
    // alert that fires on noise gets muted, and then it can never warn about
    // the real thing.
    const alert = roasAlert(weeks([4.1, 2.2]), 3);
    assert.equal(alert.firing, false);
    assert.equal(alert.weeksBelow, 1);
  });

  it("fires on the second consecutive week under target", () => {
    const alert = roasAlert(weeks([4.1, 2.2, 1.9]), 3);
    assert.equal(alert.firing, true);
    assert.equal(alert.weeksBelow, 2);
    assert.equal(alert.latestRoas, 1.9);
  });

  it("keeps firing while the streak continues", () => {
    assert.equal(roasAlert(weeks([2, 2, 2, 2]), 3).firing, true);
  });

  it("stops firing as soon as a week recovers", () => {
    assert.equal(roasAlert(weeks([1.5, 1.5, 3.6]), 3).firing, false);
  });

  it("honours a reconfigured window", () => {
    assert.equal(roasAlert(weeks([2.2, 1.9]), 3, 3).firing, false);
    assert.equal(roasAlert(weeks([2.2, 1.9, 2.0]), 3, 3).firing, true);
  });

  it("never fires for a client with no campaign data", () => {
    assert.equal(roasAlert([], 3).firing, false);
    assert.equal(roasAlert(weeks([null, null]), 3).firing, false);
  });
});

describe("weekStartOf", () => {
  it("returns the Monday of the week", () => {
    // 12 Aug 2026 is a Wednesday.
    assert.equal(weekStartOf(AT("2026-08-12")).toISOString().slice(0, 10), "2026-08-10");
  });

  it("leaves a Monday where it is", () => {
    assert.equal(weekStartOf(AT("2026-08-10")).toISOString().slice(0, 10), "2026-08-10");
  });

  it("puts Sunday in the week that just ended, not the one starting", () => {
    assert.equal(weekStartOf(AT("2026-08-16")).toISOString().slice(0, 10), "2026-08-10");
  });

  it("crosses a month boundary correctly", () => {
    assert.equal(weekStartOf(AT("2026-09-02")).toISOString().slice(0, 10), "2026-08-31");
  });

  it("is idempotent", () => {
    const once = weekStartOf(AT("2026-08-14"));
    assert.equal(weekStartOf(once).getTime(), once.getTime());
  });
});

describe("summarise", () => {
  it("re-derives ratios from the totals, not by averaging weeks", () => {
    // A quiet week with a freak ratio would otherwise drag the mean around.
    const summary = summarise([
      week({ googleSpend: 1000, metaSpend: 0, revenue: 5000, orders: 50, storeSessions: 2000 }),
      week({ googleSpend: 100, metaSpend: 0, revenue: 900, orders: 9, storeSessions: 100 }),
    ]);

    assert.equal(summary.spend, 1100);
    assert.equal(summary.revenue, 5900);
    // 5900 / 1100 = 5.36, not the 7.0 mean of 5.0 and 9.0.
    assert.equal(summary.roas, 5.36);
  });

  it("handles an empty run", () => {
    const summary = summarise([]);
    assert.equal(summary.weeks, 0);
    assert.equal(summary.roas, null);
  });
});
