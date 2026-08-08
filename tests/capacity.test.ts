import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isoWeekKey,
  isoWeekStart,
  loadBand,
  overloadWarning,
  suggestAssignee,
  weekKeysFrom,
  weekLoad,
  type Candidate,
} from "../lib/capacity";

const AT = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("loadBand", () => {
  it("maps each band to its range", () => {
    assert.equal(loadBand(0), "LIGHT");
    assert.equal(loadBand(34), "LIGHT");
    assert.equal(loadBand(35), "HEALTHY");
    assert.equal(loadBand(69), "HEALTHY");
    assert.equal(loadBand(70), "TIGHT");
    assert.equal(loadBand(90), "TIGHT");
    assert.equal(loadBand(91), "OVER");
    assert.equal(loadBand(140), "OVER");
  });
});

describe("weekLoad", () => {
  it("computes a percentage against capacity", () => {
    const load = weekLoad("2026-W33", 28, 40, 9);
    assert.equal(load.percent, 70);
    assert.equal(load.band, "TIGHT");
    assert.equal(load.milestones, 9);
  });

  it("treats zero capacity with work as over, not as infinite room", () => {
    // Someone on leave with milestones due that week is over capacity by
    // definition — dividing by zero would otherwise read as 0%.
    const load = weekLoad("2026-W33", 6, 0, 2);
    assert.equal(load.percent, 100);
    assert.equal(load.band, "OVER");
  });

  it("reports an empty week for zero capacity and no work", () => {
    assert.equal(weekLoad("2026-W33", 0, 0, 0).percent, 0);
  });
});

describe("isoWeekKey", () => {
  it("numbers a mid-year week", () => {
    // 10 Aug 2026 is a Monday, in ISO week 33.
    assert.equal(isoWeekKey(AT("2026-08-10")), "2026-W33");
    assert.equal(isoWeekKey(AT("2026-08-16")), "2026-W33", "Sunday belongs to the same week");
    assert.equal(isoWeekKey(AT("2026-08-17")), "2026-W34");
  });

  it("puts early January into the previous year's last week where ISO says so", () => {
    // 1 Jan 2027 is a Friday, so it belongs to ISO week 53 of 2026.
    assert.equal(isoWeekKey(AT("2027-01-01")), "2026-W53");
    assert.equal(isoWeekKey(AT("2027-01-04")), "2027-W01");
  });

  it("puts late December into the next year where ISO says so", () => {
    // 29 Dec 2025 is a Monday whose Thursday falls in 2026.
    assert.equal(isoWeekKey(AT("2025-12-29")), "2026-W01");
  });

  it("round-trips through isoWeekStart", () => {
    for (const iso of ["2026-01-01", "2026-03-15", "2026-08-16", "2026-12-31", "2027-01-01"]) {
      const key = isoWeekKey(AT(iso));
      assert.equal(isoWeekKey(isoWeekStart(key)), key, iso);
    }
  });

  it("always starts a week on a Monday", () => {
    for (const key of ["2026-W01", "2026-W33", "2026-W53", "2027-W01"]) {
      assert.equal(isoWeekStart(key).getUTCDay(), 1, key);
    }
  });
});

describe("weekKeysFrom", () => {
  it("returns consecutive weeks starting from the one containing the date", () => {
    assert.deepEqual(weekKeysFrom(AT("2026-08-12"), 4), [
      "2026-W33",
      "2026-W34",
      "2026-W35",
      "2026-W36",
    ]);
  });

  it("crosses a year boundary without repeating or skipping", () => {
    const keys = weekKeysFrom(AT("2026-12-21"), 4);
    assert.deepEqual(keys, ["2026-W52", "2026-W53", "2027-W01", "2027-W02"]);
    assert.equal(new Set(keys).size, keys.length);
  });
});

describe("overloadWarning", () => {
  it("does not block a member who is merely busy", () => {
    // The dialog fires at 100%, not at the amber band — a warning that fires
    // whenever someone is busy gets clicked through without reading.
    const warning = overloadWarning(30, 40, 4, "2026-W33");
    assert.equal(warning.projectedPercent, 85);
    assert.equal(warning.blocking, false);
  });

  it("does not block at exactly 100%", () => {
    const warning = overloadWarning(36, 40, 4, "2026-W33");
    assert.equal(warning.projectedPercent, 100);
    assert.equal(warning.blocking, false);
  });

  it("blocks past 100%", () => {
    const warning = overloadWarning(40, 40, 3, "2026-W33");
    assert.equal(warning.projectedPercent, 108);
    assert.equal(warning.blocking, true);
  });

  it("reports the load before as well as after", () => {
    const warning = overloadWarning(38, 40, 8, "2026-W33");
    assert.equal(warning.currentPercent, 95);
    assert.equal(warning.projectedPercent, 115);
  });
});

describe("suggestAssignee", () => {
  const candidate = (over: Partial<Candidate> = {}): Candidate => ({
    userId: "u1",
    name: "Subtain Ahmed",
    jobTitle: "Performance Marketer",
    percent: 50,
    hours: 20,
    capacityHours: 40,
    qualified: true,
    ...over,
  });

  it("prefers a qualified member even when someone unqualified is idler", () => {
    // The suggestion breaks ties inside a discipline. It must never propose
    // reassigning Meta Ads to the Shopify designer just because they're free.
    const suggestion = suggestAssignee(
      [
        candidate({ userId: "busy", qualified: true, hours: 30 }),
        candidate({ userId: "idle", qualified: false, hours: 0, name: "Shahnawaz Ali" }),
      ],
      4,
    );
    assert.equal(suggestion?.candidate.userId, "busy");
  });

  it("picks the least loaded among the qualified", () => {
    const suggestion = suggestAssignee(
      [
        candidate({ userId: "a", hours: 30 }),
        candidate({ userId: "b", hours: 12 }),
        candidate({ userId: "c", hours: 22 }),
      ],
      4,
    );
    assert.equal(suggestion?.candidate.userId, "b");
    assert.equal(suggestion?.projectedPercent, 40);
  });

  it("says so when nobody's job title matches", () => {
    const suggestion = suggestAssignee([candidate({ qualified: false })], 4);
    assert.match(suggestion?.reason ?? "", /Nobody's job title matches/);
  });

  it("flags a suggestion that would still push someone over", () => {
    const suggestion = suggestAssignee([candidate({ hours: 38 })], 6);
    assert.equal(suggestion?.projectedPercent, 110);
    assert.match(suggestion?.reason ?? "", /would take Subtain to 110%/);
  });

  it("returns nothing when there is nobody to suggest", () => {
    assert.equal(suggestAssignee([], 4), null);
  });

  it("treats a zero-capacity member as fully loaded rather than free", () => {
    const suggestion = suggestAssignee(
      [
        candidate({ userId: "away", capacityHours: 0, hours: 0 }),
        candidate({ userId: "here", capacityHours: 40, hours: 20 }),
      ],
      4,
    );
    assert.equal(suggestion?.candidate.userId, "here");
  });
});
