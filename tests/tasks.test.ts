import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bucketFor } from "../lib/tasks";
import { parseDateInput } from "../lib/date";

/**
 * Which pile a piece of work lands in.
 *
 * Every one of these is a statement about the *company's* calendar day, not the
 * server's and not the viewer's. The distinction is the whole point: a task due
 * this evening is due today, and one due half an hour after midnight is not —
 * and on a server running in UTC, "today" is already tomorrow for several hours
 * of every New York evening.
 */

const NY = "America/New_York";
const due = (day: string) => parseDateInput(day)!;

describe("bucketFor", () => {
  it("puts an undated task in Upcoming, not Overdue", () => {
    // A task nobody dated is not a task anybody is failing to do.
    assert.equal(bucketFor(null, new Date("2026-06-15T12:00:00Z"), NY), "UPCOMING");
  });

  it("calls a task due today Today, not Overdue, during that day", () => {
    // 14:00 UTC on 15 June is 10:00 in New York — mid-morning of the due day.
    assert.equal(
      bucketFor(due("2026-06-15"), new Date("2026-06-15T14:00:00Z"), NY),
      "TODAY",
    );
  });

  it("still calls it Today late in the company evening", () => {
    // 03:00 UTC on the 16th is 23:00 on the 15th in New York. A naive UTC
    // comparison would have called this overdue four hours early.
    assert.equal(
      bucketFor(due("2026-06-15"), new Date("2026-06-16T03:00:00Z"), NY),
      "TODAY",
    );
  });

  it("turns Overdue once the company day has actually ended", () => {
    // 05:00 UTC on the 16th is 01:00 in New York — the day is over.
    assert.equal(
      bucketFor(due("2026-06-15"), new Date("2026-06-16T05:00:00Z"), NY),
      "OVERDUE",
    );
  });

  it("puts tomorrow in Upcoming", () => {
    assert.equal(
      bucketFor(due("2026-06-16"), new Date("2026-06-15T14:00:00Z"), NY),
      "UPCOMING",
    );
  });

  it("holds the boundary either side of a daylight-saving change", () => {
    // 1 November 2026 is the day US clocks go back. A fixed offset would put
    // this boundary an hour out, which is how a task silently becomes late.
    assert.equal(
      bucketFor(due("2026-11-01"), new Date("2026-11-02T04:30:00Z"), NY),
      "TODAY",
    );
    assert.equal(
      bucketFor(due("2026-11-01"), new Date("2026-11-02T05:30:00Z"), NY),
      "OVERDUE",
    );
  });

  it("gives the same answers in a zone ahead of UTC", () => {
    // Proves the logic is about the zone, not about New York specifically.
    assert.equal(
      bucketFor(due("2026-06-15"), new Date("2026-06-15T10:00:00Z"), "Asia/Karachi"),
      "TODAY",
    );
    assert.equal(
      bucketFor(due("2026-06-15"), new Date("2026-06-15T20:00:00Z"), "Asia/Karachi"),
      "OVERDUE",
    );
  });
});
