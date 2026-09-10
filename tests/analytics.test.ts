import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { conversionRate, rangeFilter, resolveRange } from "../lib/analytics";

/**
 * The dashboard's arithmetic.
 *
 * Separated from the queries on purpose: a range that is off by a day, or a
 * conversion rate that reads 0% when nothing has closed, is wrong in a way
 * nobody notices until a decision is made on it. The query side is checked over
 * HTTP by permtest and journeytest; this is the part that can be pinned down
 * exactly.
 */

const anchor = new Date("2026-06-17T15:00:00Z"); // a Wednesday

describe("resolveRange", () => {
  it("starts the week on Monday", () => {
    const range = resolveRange("THIS_WEEK", anchor);
    assert.equal(range.from?.toISOString(), "2026-06-15T00:00:00.000Z");
    assert.equal(range.to?.toISOString(), "2026-06-22T00:00:00.000Z");
  });

  it("covers the whole calendar month", () => {
    const range = resolveRange("THIS_MONTH", anchor);
    assert.equal(range.from?.toISOString(), "2026-06-01T00:00:00.000Z");
    assert.equal(range.to?.toISOString(), "2026-07-01T00:00:00.000Z");
  });

  it("rolls back across a year boundary", () => {
    const range = resolveRange("LAST_MONTH", new Date("2026-01-10T12:00:00Z"));
    assert.equal(range.from?.toISOString(), "2025-12-01T00:00:00.000Z");
    assert.equal(range.to?.toISOString(), "2026-01-01T00:00:00.000Z");
  });

  it("leaves all-time open at both ends", () => {
    const range = resolveRange("ALL_TIME", anchor);
    assert.equal(range.from, null);
    assert.equal(range.to, null);
  });

  it("includes the last day of a custom range", () => {
    // "1st to 5th" has to include the 5th. An end of 5th-midnight would drop
    // the entire day, which reads as correct and quietly loses a day's work.
    const range = resolveRange("CUSTOM", anchor, { from: "2026-06-01", to: "2026-06-05" });
    assert.equal(range.from?.toISOString(), "2026-06-01T00:00:00.000Z");
    assert.equal(range.to?.toISOString(), "2026-06-06T00:00:00.000Z");
  });

  it("survives an unparseable custom range", () => {
    const range = resolveRange("CUSTOM", anchor, { from: "not-a-date", to: null });
    assert.equal(range.from, null);
    assert.equal(range.to, null);
  });
});

describe("rangeFilter", () => {
  it("is undefined for an open range, so no filter is applied", () => {
    assert.equal(rangeFilter({ from: null, to: null }), undefined);
  });

  it("uses an exclusive upper bound", () => {
    const filter = rangeFilter(resolveRange("THIS_MONTH", anchor));
    assert.ok(filter && "lt" in filter, "upper bound should be lt, never lte");
  });
});

describe("conversionRate", () => {
  it("is null when nothing has closed", () => {
    // Not 0: "no data" and "lost everything" are different claims, and 0% makes
    // the second one on a dashboard that has never had a deal.
    assert.equal(conversionRate(0, 0), null);
  });

  it("counts won against closed, ignoring open deals", () => {
    assert.equal(conversionRate(3, 1), 75);
  });

  it("is 100 when nothing was lost", () => {
    assert.equal(conversionRate(4, 0), 100);
  });

  it("is 0 when everything was lost", () => {
    assert.equal(conversionRate(0, 5), 0);
  });

  it("rounds to whole percent", () => {
    assert.equal(conversionRate(1, 2), 33);
  });
});
