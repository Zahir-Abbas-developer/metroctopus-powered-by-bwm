import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  cryptoRandom,
  feasibleCount,
  generateCheckMinutes,
  planChecksForDay,
  violatesConstraints,
  type ScheduleConfig,
} from "../lib/attendance-schedule";
import { karachiInstant, karachiMinutes } from "../lib/attendance-time";

/** The shipped defaults: 3 checks, 12:45 earliest, 21:00 latest, 90-min gaps. */
const DEFAULTS: ScheduleConfig = {
  count: 3,
  earliestMinutes: 12 * 60 + 45,
  latestMinutes: 21 * 60,
  minGapMinutes: 90,
};

describe("generateCheckMinutes — 1000 simulated days", () => {
  it("never violates a single constraint", () => {
    for (let day = 0; day < 1000; day += 1) {
      const minutes = generateCheckMinutes(DEFAULTS, cryptoRandom);

      assert.equal(minutes.length, 3, `day ${day} produced ${minutes.length} checks`);

      const violation = violatesConstraints(minutes, DEFAULTS);
      assert.equal(violation, null, `day ${day}: ${violation}`);
    }
  });

  it("never schedules a check whose window would run past 10 PM", () => {
    const shiftEnd = 22 * 60;

    for (let day = 0; day < 1000; day += 1) {
      for (const minute of generateCheckMinutes(DEFAULTS, cryptoRandom)) {
        assert.ok(
          minute + 60 <= shiftEnd,
          `a check at ${minute} would close at ${minute + 60}, past ${shiftEnd}`,
        );
      }
    }
  });

  it("produces a different schedule almost every day", () => {
    const seen = new Set<string>();
    for (let day = 0; day < 1000; day += 1) {
      seen.add(generateCheckMinutes(DEFAULTS, cryptoRandom).join(","));
    }

    // Collisions are possible but should be vanishingly rare; anything under
    // 990 distinct schedules means the source is not behaving randomly.
    assert.ok(seen.size > 990, `only ${seen.size} distinct schedules in 1000 days`);
  });

  it("spreads checks across the whole window rather than clustering", () => {
    // If the generator were biased — say, always pushing the first check to the
    // earliest slot — the observed minimum and maximum would barely move.
    let firstMin = Infinity;
    let firstMax = -Infinity;
    let lastMin = Infinity;
    let lastMax = -Infinity;

    for (let day = 0; day < 1000; day += 1) {
      const minutes = generateCheckMinutes(DEFAULTS, cryptoRandom);
      firstMin = Math.min(firstMin, minutes[0]);
      firstMax = Math.max(firstMax, minutes[0]);
      lastMin = Math.min(lastMin, minutes[2]);
      lastMax = Math.max(lastMax, minutes[2]);
    }

    assert.ok(firstMax - firstMin > 120, `first check only spanned ${firstMax - firstMin} minutes`);
    assert.ok(lastMax - lastMin > 120, `last check only spanned ${lastMax - lastMin} minutes`);
  });
});

describe("generateCheckMinutes — determinism under an injected source", () => {
  it("places checks exactly where the entropy says", () => {
    // free = (1260 - 765) - 2*90 = 315. All zeros means the earliest legal
    // arrangement: earliest, +90, +180.
    const zeros = generateCheckMinutes(DEFAULTS, () => 0);
    assert.deepEqual(zeros, [765, 855, 945]);

    // All maximum means the latest legal arrangement, ending exactly at 21:00.
    const maxed = generateCheckMinutes(DEFAULTS, (max) => max - 1);
    assert.deepEqual(maxed, [1080, 1170, 1260]);
    assert.equal(maxed[2], DEFAULTS.latestMinutes);
  });

  it("sorts regardless of the order the source produces", () => {
    const values = [300, 10, 150];
    let index = 0;
    const minutes = generateCheckMinutes(DEFAULTS, () => values[index++]);

    assert.deepEqual(minutes, [775, 1005, 1245]);
    assert.equal(violatesConstraints(minutes, DEFAULTS), null);
  });
});

describe("feasibleCount", () => {
  it("returns the full count when there is room", () => {
    assert.equal(feasibleCount(DEFAULTS), 3);
  });

  it("degrades rather than failing when a late clock-in compresses the day", () => {
    // 19:45 to 21:00 is 75 minutes — room for one check only.
    assert.equal(
      feasibleCount({ ...DEFAULTS, earliestMinutes: 19 * 60 + 45 }),
      1,
    );
    // 18:00 to 21:00 is 180 minutes — room for exactly three at 90-minute gaps.
    assert.equal(feasibleCount({ ...DEFAULTS, earliestMinutes: 18 * 60 }), 3);
    // 19:00 to 21:00 is 120 minutes — room for two.
    assert.equal(feasibleCount({ ...DEFAULTS, earliestMinutes: 19 * 60 }), 2);
  });

  it("returns zero when the window has closed entirely", () => {
    assert.equal(feasibleCount({ ...DEFAULTS, earliestMinutes: 21 * 60 + 30 }), 0);
    assert.deepEqual(
      generateCheckMinutes({ ...DEFAULTS, earliestMinutes: 21 * 60 + 30 }),
      [],
    );
  });

  it("still respects the constraints when it degrades", () => {
    for (const earliest of [18 * 60, 19 * 60, 19 * 60 + 45, 20 * 60 + 30]) {
      const config = { ...DEFAULTS, earliestMinutes: earliest };
      for (let day = 0; day < 200; day += 1) {
        const minutes = generateCheckMinutes(config, cryptoRandom);
        assert.equal(minutes.length, feasibleCount(config));
        assert.equal(violatesConstraints(minutes, config), null);
      }
    }
  });

  it("honours a changed count and gap from settings", () => {
    const five: ScheduleConfig = { ...DEFAULTS, count: 5, minGapMinutes: 60 };
    for (let day = 0; day < 200; day += 1) {
      const minutes = generateCheckMinutes(five, cryptoRandom);
      assert.equal(minutes.length, 5);
      assert.equal(violatesConstraints(minutes, five), null);
    }
  });
});

describe("planChecksForDay", () => {
  const day = new Date("2026-08-10T00:00:00.000Z");

  it("starts no earlier than clock-in plus the offset", () => {
    // Clock in at 14:00 Karachi; checks must not use the 12:45 floor.
    const clockInAt = karachiInstant(day, 14 * 60);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const checks = planChecksForDay({
        day,
        clockInAt,
        // The caller passes earliest already offset from clock-in.
        config: { ...DEFAULTS, earliestMinutes: 14 * 60 + 45 },
        windowMinutes: 60,
      });

      for (const check of checks) {
        assert.ok(
          karachiMinutes(check.scheduledAt) >= 14 * 60 + 45,
          "a check landed before clock-in + 45",
        );
      }
    }
  });

  it("closes every window by the end of the shift", () => {
    const clockInAt = karachiInstant(day, 12 * 60);
    const shiftEnd = karachiInstant(day, 22 * 60);

    for (let attempt = 0; attempt < 200; attempt += 1) {
      for (const check of planChecksForDay({
        day,
        clockInAt,
        config: DEFAULTS,
        windowMinutes: 60,
      })) {
        assert.ok(
          check.windowEndsAt.getTime() <= shiftEnd.getTime(),
          `window closed at ${check.windowEndsAt.toISOString()}, past the shift`,
        );
        assert.equal(
          check.windowEndsAt.getTime() - check.scheduledAt.getTime(),
          60 * 60_000,
        );
      }
    }
  });

  it("returns instants in ascending order", () => {
    const checks = planChecksForDay({
      day,
      clockInAt: karachiInstant(day, 12 * 60),
      config: DEFAULTS,
      windowMinutes: 60,
    });

    for (let index = 1; index < checks.length; index += 1) {
      assert.ok(
        checks[index].scheduledAt.getTime() > checks[index - 1].scheduledAt.getTime(),
        "checks came back out of order",
      );
    }
  });

  it("gives two members on the same day different schedules", () => {
    const clockInAt = karachiInstant(day, 12 * 60);
    const plan = () =>
      planChecksForDay({ day, clockInAt, config: DEFAULTS, windowMinutes: 60 })
        .map((check) => check.scheduledAt.toISOString())
        .join(",");

    const schedules = new Set(Array.from({ length: 50 }, plan));
    assert.ok(schedules.size > 45, "schedules repeated across members");
  });
});
