import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  COMPANY_TIMEZONE,
  dueDeadline,
  parseDateInput,
  toDateOnly,
  utcOffsetHours,
} from "../lib/date";

/**
 * The company clock.
 *
 * These exist because the timezone arithmetic had no tests at all, and that is
 * how it survived being wrong: `lib/date.ts` hardcoded `Asia/Karachi` and a
 * fixed `UTC+5` offset long after CLAUDE.md made the timezone a company setting
 * defaulting to `America/New_York`. The whole suite passed while every due date
 * in the product was on the wrong clock, because nothing looked.
 *
 * The offset one matters most. Karachi is +5 all year, so a constant was fine;
 * New York is -5 in winter and -4 on daylight time, so a constant is wrong for
 * half the year — and "half the year" is the kind of bug that gets found in
 * March by somebody whose deadline moved.
 */

describe("company timezone", () => {
  it("defaults to the zone CLAUDE.md specifies", () => {
    assert.equal(COMPANY_TIMEZONE, "America/New_York");
  });
});

describe("utcOffsetHours", () => {
  it("reads New York as UTC-5 on a winter date", () => {
    assert.equal(utcOffsetHours(new Date("2026-01-15T12:00:00Z"), "America/New_York"), -5);
  });

  it("reads New York as UTC-4 on a summer date", () => {
    // The bug a fixed offset cannot express: same zone, different offset.
    assert.equal(utcOffsetHours(new Date("2026-07-15T12:00:00Z"), "America/New_York"), -4);
  });

  it("reads Karachi as UTC+5 in both", () => {
    assert.equal(utcOffsetHours(new Date("2026-01-15T12:00:00Z"), "Asia/Karachi"), 5);
    assert.equal(utcOffsetHours(new Date("2026-07-15T12:00:00Z"), "Asia/Karachi"), 5);
  });

  it("reads UTC as zero", () => {
    assert.equal(utcOffsetHours(new Date("2026-03-01T00:00:00Z"), "UTC"), 0);
  });
});

describe("dueDeadline", () => {
  it("lands on local midnight after a winter due date", () => {
    // Due 15 January in New York → 05:00 UTC on the 16th.
    const deadline = dueDeadline(parseDateInput("2026-01-15")!, "America/New_York");
    assert.equal(deadline.toISOString(), "2026-01-16T05:00:00.000Z");
  });

  it("lands on local midnight after a summer due date", () => {
    // Same calendar position, one hour earlier in UTC, because of DST. A fixed
    // offset would put this at 05:00 and call work late an hour before it is.
    const deadline = dueDeadline(parseDateInput("2026-07-15")!, "America/New_York");
    assert.equal(deadline.toISOString(), "2026-07-16T04:00:00.000Z");
  });

  it("is still correct for a zone that never shifts", () => {
    const deadline = dueDeadline(parseDateInput("2026-07-15")!, "Asia/Karachi");
    assert.equal(deadline.toISOString(), "2026-07-15T19:00:00.000Z");
  });

  it("is always after the start of its own day", () => {
    for (const day of ["2026-01-15", "2026-03-08", "2026-07-15", "2026-11-01"]) {
      const parsed = parseDateInput(day)!;
      assert.ok(
        dueDeadline(parsed, "America/New_York").getTime() > toDateOnly(parsed).getTime(),
        `${day} deadline should fall after the day it belongs to`,
      );
    }
  });
});
