import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  adminTally,
  isResolved,
  visibleCheck,
  visibleChecks,
  visibleTally,
  type StoredCheck,
} from "../lib/attendance-visibility";

const AT = (iso: string) => new Date(iso);

function check(overrides: Partial<StoredCheck> = {}): StoredCheck {
  return {
    id: "c1",
    scheduledAt: AT("2026-08-10T11:12:00.000Z"), // 16:12 Karachi
    windowEndsAt: AT("2026-08-10T12:12:00.000Z"),
    respondedAt: null,
    status: "SCHEDULED",
    ...overrides,
  };
}

describe("the secrecy rule", () => {
  it("tells a member nothing at all about a scheduled check", () => {
    assert.equal(visibleCheck(check({ status: "SCHEDULED" })), null);
  });

  it("hides scheduled checks from a mixed list", () => {
    const visible = visibleChecks([
      check({ id: "past", status: "PASSED", respondedAt: AT("2026-08-10T11:20:00.000Z") }),
      check({ id: "future", status: "SCHEDULED", scheduledAt: AT("2026-08-10T14:00:00.000Z") }),
      check({ id: "now", status: "ACTIVE" }),
    ]);

    assert.deepEqual(
      visible.map((entry) => entry.id).sort(),
      ["now", "past"],
      "a scheduled check leaked into the member payload",
    );
  });

  it("leaves no trace of a future time anywhere in the serialised payload", () => {
    // The real guarantee: not just "no scheduledAt field", but that the secret
    // value cannot be recovered from the JSON by any route.
    const secret = AT("2026-08-10T15:47:00.000Z");

    const payload = JSON.stringify({
      checks: visibleChecks([
        check({ id: "future", status: "SCHEDULED", scheduledAt: secret, windowEndsAt: new Date(secret.getTime() + 3_600_000) }),
        check({ id: "done", status: "PASSED", respondedAt: AT("2026-08-10T11:20:00.000Z") }),
      ]),
      tally: visibleTally([check({ status: "SCHEDULED", scheduledAt: secret })]),
    });

    assert.doesNotMatch(payload, /15:47/, "the secret time appeared in the payload");
    assert.doesNotMatch(payload, /2026-08-10T15:47/, "the secret instant appeared verbatim");
    assert.doesNotMatch(payload, /"future"/, "the pending check's id leaked");
  });

  it("never reports how many checks are still to come", () => {
    // Two done, two pending. A member who learns "4 total" knows two are left.
    const checks = [
      check({ id: "a", status: "PASSED", respondedAt: AT("2026-08-10T11:20:00.000Z") }),
      check({ id: "b", status: "MISSED" }),
      check({ id: "c", status: "SCHEDULED" }),
      check({ id: "d", status: "SCHEDULED" }),
    ];

    const tally = visibleTally(checks);
    assert.deepEqual(tally, { passed: 1, missed: 1, cancelled: 0, resolved: 2 });

    const serialised = JSON.stringify(tally);
    assert.doesNotMatch(serialised, /"pending"/);
    assert.doesNotMatch(serialised, /"total"/);
    assert.doesNotMatch(serialised, /4/, "a count that implies pending checks leaked");
  });
});

describe("what a member may see", () => {
  it("shows an active check, because it is on screen demanding an answer", () => {
    const visible = visibleCheck(check({ status: "ACTIVE" }));
    assert.equal(visible?.status, "ACTIVE");
    // The window end is needed for the countdown.
    assert.equal(visible?.windowEndsAt, "2026-08-10T12:12:00.000Z");
  });

  it("shows resolved checks with how fast they answered", () => {
    const visible = visibleCheck(
      check({ status: "PASSED", respondedAt: AT("2026-08-10T11:15:30.000Z") }),
    );

    assert.equal(visible?.status, "PASSED");
    assert.equal(visible?.responseSeconds, 210);
  });

  it("reports no response time for a missed check", () => {
    const visible = visibleCheck(check({ status: "MISSED" }));
    assert.equal(visible?.status, "MISSED");
    assert.equal(visible?.responseSeconds, null);
  });

  it("never returns a negative response time", () => {
    // Defensive: a clock adjustment must not produce "-4 seconds".
    const visible = visibleCheck(
      check({ status: "PASSED", respondedAt: AT("2026-08-10T11:00:00.000Z") }),
    );
    assert.equal(visible?.responseSeconds, 0);
  });

  it("returns resolved checks in chronological order", () => {
    const visible = visibleChecks([
      check({ id: "late", status: "PASSED", scheduledAt: AT("2026-08-10T14:00:00.000Z") }),
      check({ id: "early", status: "MISSED", scheduledAt: AT("2026-08-10T09:00:00.000Z") }),
    ]);

    assert.deepEqual(visible.map((entry) => entry.id), ["early", "late"]);
  });
});

describe("the admin view", () => {
  it("reports progress without revealing a single scheduled time", () => {
    const secret = AT("2026-08-10T15:47:00.000Z");
    const tally = adminTally([
      check({ status: "PASSED" }),
      check({ status: "PASSED" }),
      check({ status: "ACTIVE" }),
      check({ status: "SCHEDULED", scheduledAt: secret }),
      check({ status: "MISSED" }),
    ]);

    assert.deepEqual(tally, {
      total: 5,
      passed: 2,
      missed: 1,
      active: 1,
      pending: 1,
      cancelled: 0,
    });

    assert.doesNotMatch(JSON.stringify(tally), /15:47/);
  });

  it("counts an empty day without crashing", () => {
    assert.deepEqual(adminTally([]), {
      total: 0,
      passed: 0,
      missed: 0,
      active: 0,
      pending: 0,
      cancelled: 0,
    });
  });
});

describe("isResolved", () => {
  it("treats only finished states as resolved", () => {
    assert.equal(isResolved("PASSED"), true);
    assert.equal(isResolved("MISSED"), true);
    assert.equal(isResolved("CANCELLED"), true);
    assert.equal(isResolved("ACTIVE"), false);
    assert.equal(isResolved("SCHEDULED"), false);
  });
});
