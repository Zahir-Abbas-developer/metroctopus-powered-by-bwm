import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  breakAllowance,
  breakMinutesUsed,
  checksCoveredByOutage,
  overlaps,
  shiftCheckAfterBreak,
  totalMinutes,
} from "../lib/fairness-windows";

const AT = (iso: string) => new Date(iso);
const MINUTE = 60_000;

/** 16:00–17:00 Karachi on 10 Aug 2026, as UTC. */
const CHECK = { scheduledAt: AT("2026-08-10T11:00:00.000Z"), windowEndsAt: AT("2026-08-10T12:00:00.000Z") };

describe("overlaps", () => {
  it("is true when one interval starts inside the other", () => {
    assert.equal(
      overlaps(
        { start: AT("2026-08-10T11:00:00.000Z"), end: AT("2026-08-10T12:00:00.000Z") },
        { start: AT("2026-08-10T11:30:00.000Z"), end: AT("2026-08-10T13:00:00.000Z") },
      ),
      true,
    );
  });

  it("is true when one interval fully contains the other", () => {
    assert.equal(
      overlaps(
        { start: AT("2026-08-10T11:00:00.000Z"), end: AT("2026-08-10T12:00:00.000Z") },
        { start: AT("2026-08-10T09:00:00.000Z"), end: AT("2026-08-10T15:00:00.000Z") },
      ),
      true,
    );
  });

  it("is false when they merely touch at an instant", () => {
    // An outage that ends exactly when the window opens covers nothing: the
    // lights were back on before the question was asked.
    assert.equal(
      overlaps(
        { start: AT("2026-08-10T11:00:00.000Z"), end: AT("2026-08-10T12:00:00.000Z") },
        { start: AT("2026-08-10T09:00:00.000Z"), end: AT("2026-08-10T11:00:00.000Z") },
      ),
      false,
    );
    assert.equal(
      overlaps(
        { start: AT("2026-08-10T11:00:00.000Z"), end: AT("2026-08-10T12:00:00.000Z") },
        { start: AT("2026-08-10T12:00:00.000Z"), end: AT("2026-08-10T14:00:00.000Z") },
      ),
      false,
    );
  });

  it("is false when they are far apart, in either order", () => {
    const a = { start: AT("2026-08-10T08:00:00.000Z"), end: AT("2026-08-10T09:00:00.000Z") };
    const b = { start: AT("2026-08-10T14:00:00.000Z"), end: AT("2026-08-10T15:00:00.000Z") };
    assert.equal(overlaps(a, b), false);
    assert.equal(overlaps(b, a), false);
  });

  it("is symmetric for every pair", () => {
    const spans = [
      { start: AT("2026-08-10T10:00:00.000Z"), end: AT("2026-08-10T12:00:00.000Z") },
      { start: AT("2026-08-10T11:00:00.000Z"), end: AT("2026-08-10T11:30:00.000Z") },
      { start: AT("2026-08-10T12:00:00.000Z"), end: AT("2026-08-10T13:00:00.000Z") },
      { start: AT("2026-08-10T09:00:00.000Z"), end: AT("2026-08-10T10:00:00.000Z") },
    ];
    for (const a of spans) {
      for (const b of spans) {
        assert.equal(overlaps(a, b), overlaps(b, a));
      }
    }
  });
});

describe("checksCoveredByOutage", () => {
  it("covers a check the outage clipped by a single minute", () => {
    // Power back at 16:01 — the member still could not answer at 16:00.
    const covered = checksCoveredByOutage([CHECK], {
      start: AT("2026-08-10T10:00:00.000Z"),
      end: AT("2026-08-10T11:01:00.000Z"),
    });
    assert.equal(covered.length, 1);
  });

  it("does not require the outage to span the whole window", () => {
    const covered = checksCoveredByOutage([CHECK], {
      start: AT("2026-08-10T11:55:00.000Z"),
      end: AT("2026-08-10T12:30:00.000Z"),
    });
    assert.equal(covered.length, 1);
  });

  it("leaves untouched checks alone", () => {
    const other = {
      scheduledAt: AT("2026-08-10T14:00:00.000Z"),
      windowEndsAt: AT("2026-08-10T15:00:00.000Z"),
    };
    const covered = checksCoveredByOutage([CHECK, other], {
      start: AT("2026-08-10T10:30:00.000Z"),
      end: AT("2026-08-10T11:30:00.000Z"),
    });
    assert.deepEqual(covered, [CHECK]);
  });

  it("returns nothing for an outage that missed every check", () => {
    assert.deepEqual(
      checksCoveredByOutage([CHECK], {
        start: AT("2026-08-10T05:00:00.000Z"),
        end: AT("2026-08-10T06:00:00.000Z"),
      }),
      [],
    );
  });
});

describe("totalMinutes", () => {
  it("sums closed intervals", () => {
    assert.equal(
      totalMinutes([
        { start: AT("2026-08-10T11:00:00.000Z"), end: AT("2026-08-10T11:20:00.000Z") },
        { start: AT("2026-08-10T13:00:00.000Z"), end: AT("2026-08-10T13:45:00.000Z") },
      ]),
      65,
    );
  });

  it("never returns a negative total from an inverted interval", () => {
    assert.equal(
      totalMinutes([
        { start: AT("2026-08-10T13:00:00.000Z"), end: AT("2026-08-10T11:00:00.000Z") },
      ]),
      0,
    );
  });
});

describe("shiftCheckAfterBreak", () => {
  const LATEST = AT("2026-08-10T16:00:00.000Z"); // 21:00 Karachi

  it("moves the check to just after the break", () => {
    const outcome = shiftCheckAfterBreak({
      breakEndedAt: AT("2026-08-10T12:00:00.000Z"),
      settleMinutes: 5,
      windowMinutes: 60,
      latestScheduledAt: LATEST,
    });

    assert.equal(outcome.action, "SHIFT");
    if (outcome.action !== "SHIFT") return;
    assert.equal(outcome.scheduledAt.toISOString(), "2026-08-10T12:05:00.000Z");
    assert.equal(outcome.windowEndsAt.toISOString(), "2026-08-10T13:05:00.000Z");
  });

  it("drops the check when the break ran past the day's cutoff", () => {
    // The case worth being sure about: dropped is CANCELLED, never MISSED.
    // A check the member was never actually put is not one they can fail.
    const outcome = shiftCheckAfterBreak({
      breakEndedAt: AT("2026-08-10T15:58:00.000Z"),
      settleMinutes: 5,
      windowMinutes: 60,
      latestScheduledAt: LATEST,
    });

    assert.equal(outcome.action, "DROP");
    if (outcome.action !== "DROP") return;
    assert.match(outcome.reason, /not missed/);
  });

  it("still fits a check landing exactly on the cutoff", () => {
    const outcome = shiftCheckAfterBreak({
      breakEndedAt: new Date(LATEST.getTime() - 5 * MINUTE),
      settleMinutes: 5,
      windowMinutes: 60,
      latestScheduledAt: LATEST,
    });
    assert.equal(outcome.action, "SHIFT");
  });

  it("drops it one minute past the cutoff", () => {
    const outcome = shiftCheckAfterBreak({
      breakEndedAt: new Date(LATEST.getTime() - 4 * MINUTE),
      settleMinutes: 5,
      windowMinutes: 60,
      latestScheduledAt: LATEST,
    });
    assert.equal(outcome.action, "DROP");
  });
});

describe("breakMinutesUsed", () => {
  const NOW = AT("2026-08-10T12:00:00.000Z");

  it("sums closed sessions from their recorded minutes", () => {
    assert.equal(
      breakMinutesUsed(
        [
          { startedAt: AT("2026-08-10T09:00:00.000Z"), endedAt: AT("2026-08-10T09:20:00.000Z"), minutes: 20 },
          { startedAt: AT("2026-08-10T10:00:00.000Z"), endedAt: AT("2026-08-10T10:35:00.000Z"), minutes: 35 },
        ],
        NOW,
      ),
      55,
    );
  });

  it("counts an open break as it runs", () => {
    // A member two hours into a "break" should read as over allowance now,
    // not once they come back.
    assert.equal(
      breakMinutesUsed(
        [{ startedAt: AT("2026-08-10T11:30:00.000Z"), endedAt: null, minutes: null }],
        NOW,
      ),
      30,
    );
  });

  it("is zero for a day with no breaks", () => {
    assert.equal(breakMinutesUsed([], NOW), 0);
  });
});

describe("breakAllowance", () => {
  it("reports what is left inside the allowance", () => {
    assert.deepEqual(breakAllowance(35, 90), {
      used: 35,
      allowance: 90,
      remaining: 55,
      overBy: 0,
      exceeded: false,
    });
  });

  it("is not exceeded at exactly the allowance", () => {
    assert.equal(breakAllowance(90, 90).exceeded, false);
  });

  it("reports the overrun without ever going negative", () => {
    const over = breakAllowance(115, 90);
    assert.equal(over.exceeded, true);
    assert.equal(over.overBy, 25);
    assert.equal(over.remaining, 0);
  });
});
