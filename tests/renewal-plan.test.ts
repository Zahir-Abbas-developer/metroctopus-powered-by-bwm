import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  carryOverDueDate,
  cycleLengthDays,
  cycleTitle,
  nextCycleWindow,
  shiftDueDate,
  shouldCarryOver,
} from "../lib/renewal-plan";

const AT = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);

describe("nextCycleWindow", () => {
  it("starts the day after the old cycle ended", () => {
    const window = nextCycleWindow({ startDate: AT("2026-08-01"), endDate: AT("2026-08-31") });
    assert.equal(iso(window.startDate), "2026-09-01");
  });

  it("keeps the cycle the same length", () => {
    const previous = { startDate: AT("2026-08-01"), endDate: AT("2026-08-31") };
    const window = nextCycleWindow(previous);
    assert.equal(
      cycleLengthDays(window.startDate, window.endDate),
      cycleLengthDays(previous.startDate, previous.endDate),
    );
  });

  it("preserves a mid-month cycle rather than snapping to a calendar month", () => {
    // A client onboarded on the 12th is on a 12th-to-11th cycle. Snapping the
    // renewal to the 1st would silently give them a short month and move every
    // deadline they have already agreed to.
    const window = nextCycleWindow({ startDate: AT("2026-08-12"), endDate: AT("2026-09-11") });
    assert.equal(iso(window.startDate), "2026-09-12");
    assert.equal(iso(window.endDate), "2026-10-12");
  });

  it("reports the shift the dates need", () => {
    const window = nextCycleWindow({ startDate: AT("2026-08-01"), endDate: AT("2026-08-31") });
    assert.equal(window.shiftDays, 31);
  });

  it("handles a cycle that crosses a year boundary", () => {
    const window = nextCycleWindow({ startDate: AT("2026-12-15"), endDate: AT("2027-01-14") });
    assert.equal(iso(window.startDate), "2027-01-15");
    assert.equal(iso(window.endDate), "2027-02-14");
  });
});

describe("shiftDueDate", () => {
  const window = nextCycleWindow({ startDate: AT("2026-08-01"), endDate: AT("2026-08-31") });

  it("moves a mid-cycle date by the same shift", () => {
    // Day 8 of the old cycle becomes day 8 of the new one.
    assert.equal(iso(shiftDueDate(AT("2026-08-09"), window)), "2026-09-09");
  });

  it("keeps the first and last days at the edges", () => {
    assert.equal(iso(shiftDueDate(AT("2026-08-01"), window)), "2026-09-01");
    assert.equal(iso(shiftDueDate(AT("2026-08-31"), window)), "2026-10-01");
  });

  it("clamps a date that was pushed past the old cycle's end", () => {
    // Someone moved this out by hand. Without the clamp it lands outside the
    // new window and never appears on the board.
    const clamped = shiftDueDate(AT("2026-10-20"), window);
    assert.ok(clamped <= window.endDate);
    assert.equal(iso(clamped), iso(window.endDate));
  });

  it("clamps a date from before the old cycle started", () => {
    const clamped = shiftDueDate(AT("2026-06-01"), window);
    assert.equal(iso(clamped), iso(window.startDate));
  });

  it("always lands inside the new window", () => {
    for (let day = -40; day <= 80; day += 1) {
      const source = new Date(AT("2026-08-01").getTime() + day * 86_400_000);
      const shifted = shiftDueDate(source, window);
      assert.ok(shifted >= window.startDate && shifted <= window.endDate, `day ${day}`);
    }
  });
});

describe("carryOverDueDate", () => {
  const window = nextCycleWindow({ startDate: AT("2026-08-01"), endDate: AT("2026-08-31") });

  it("lands a few days into the new cycle, not on day one", () => {
    // Carried work arrives alongside a full new month. Dating it to the 1st
    // guarantees it is late again immediately.
    assert.equal(iso(carryOverDueDate(window, 5)), "2026-09-06");
  });

  it("clamps to the cycle end for a very short cycle", () => {
    const short = nextCycleWindow({ startDate: AT("2026-08-01"), endDate: AT("2026-08-03") });
    assert.equal(iso(carryOverDueDate(short, 30)), iso(short.endDate));
  });

  it("treats a negative setting as day one rather than reaching backwards", () => {
    assert.equal(iso(carryOverDueDate(window, -5)), "2026-09-01");
  });
});

describe("shouldCarryOver", () => {
  // This decides *carry-over*, not cloning: every milestone is re-created in
  // the next cycle because a retainer's work recurs. What this answers is
  // whether the copy is flagged as unfinished and re-dated close to the start.
  it("carries unfinished work forward", () => {
    for (const status of ["PENDING", "IN_PROGRESS", "BLOCKED", "MISSED"]) {
      assert.equal(shouldCarryOver(status), true, status);
    }
  });

  it("does not flag completed work — it simply recurs next month", () => {
    assert.equal(shouldCarryOver("COMPLETED"), false);
  });

  it("does not flag submitted work either", () => {
    // It was delivered and is in the owner's review queue. Next cycle's copy
    // is next month's instance of the same deliverable, not a second attempt
    // at this month's — so it recurs rather than carrying.
    assert.equal(shouldCarryOver("SUBMITTED"), false);
  });
});

describe("cycleTitle", () => {
  it("names the cycle for the month it starts in", () => {
    assert.equal(cycleTitle(AT("2026-12-01")), "Dec 2026 Retainer");
  });

  it("names a mid-month cycle for its start, not its end", () => {
    // 12 Dec to 11 Jan is the December retainer to everyone involved.
    assert.equal(cycleTitle(AT("2026-12-12")), "Dec 2026 Retainer");
  });

  it("uses agency time, so a late-evening UTC date doesn't slip a month", () => {
    // 2026-11-30T20:00Z is already 1 December in Karachi.
    assert.equal(cycleTitle(new Date("2026-11-30T20:00:00.000Z")), "Dec 2026 Retainer");
  });
});
