import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  KARACHI_UTC_OFFSET_MINUTES,
  formatDuration,
  formatKarachiClock,
  formatKarachiRange,
  formatKarachiTime,
  isWorkday,
  karachiDateString,
  karachiDay,
  karachiInstant,
  karachiMinutes,
  karachiWeekday,
  minutesBetween,
  parseWorkdays,
} from "../lib/attendance-time";

describe("the UTC+5 assumption", () => {
  it("matches what the platform's own timezone database says, all year", () => {
    // If Pakistan ever reintroduces daylight saving, this is the test that
    // fails and tells us the constant has to become a lookup.
    for (const month of ["01", "04", "07", "10"]) {
      const instant = new Date(`2026-${month}-15T00:00:00.000Z`);
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Karachi",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(instant);

      const [hours, minutes] = parts.split(":").map(Number);
      assert.equal(
        hours * 60 + minutes,
        KARACHI_UTC_OFFSET_MINUTES,
        `offset drifted in month ${month}`,
      );
    }
  });
});

describe("karachiMinutes", () => {
  it("converts an instant to minutes past Karachi midnight", () => {
    // 07:00 UTC is 12:00 in Karachi — the start of the shift.
    assert.equal(karachiMinutes(new Date("2026-08-10T07:00:00.000Z")), 720);
    assert.equal(karachiMinutes(new Date("2026-08-10T17:00:00.000Z")), 1320);
    assert.equal(karachiMinutes(new Date("2026-08-10T19:00:00.000Z")), 0);
  });

  it("is unaffected by the machine's own timezone", () => {
    // The value is derived arithmetically from the UTC instant, so a process
    // running in Tokyo or Los Angeles computes the same number.
    const instant = new Date("2026-08-10T07:00:00.000Z");
    const original = process.env.TZ;

    for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      assert.equal(karachiMinutes(instant), 720, `wrong under TZ=${tz}`);
      assert.equal(karachiDateString(instant), "2026-08-10", `wrong date under TZ=${tz}`);
    }

    process.env.TZ = original;
  });
});

describe("karachiDateString", () => {
  it("rolls the date over at Karachi midnight, not UTC midnight", () => {
    // 18:59 UTC is 23:59 the same day in Karachi.
    assert.equal(karachiDateString(new Date("2026-08-10T18:59:00.000Z")), "2026-08-10");
    // 19:00 UTC is 00:00 the next day.
    assert.equal(karachiDateString(new Date("2026-08-10T19:00:00.000Z")), "2026-08-11");
  });

  it("puts a late-evening shift on the day it started", () => {
    // 21:30 Karachi, still inside the 12:00–22:00 shift of the 10th.
    const instant = new Date("2026-08-10T16:30:00.000Z");
    assert.equal(karachiDateString(instant), "2026-08-10");
    assert.equal(karachiMinutes(instant), 21 * 60 + 30);
  });
});

describe("karachiInstant", () => {
  it("is the inverse of karachiMinutes", () => {
    const day = new Date("2026-08-10T00:00:00.000Z");

    for (const minutes of [0, 690, 720, 735, 900, 1260, 1320, 1439]) {
      const instant = karachiInstant(day, minutes);
      assert.equal(karachiMinutes(instant), minutes % 1440, `round trip failed at ${minutes}`);
    }
  });

  it("resolves noon Karachi to 07:00 UTC", () => {
    const instant = karachiInstant(new Date("2026-08-10T00:00:00.000Z"), 720);
    assert.equal(instant.toISOString(), "2026-08-10T07:00:00.000Z");
  });

  it("accepts any instant inside the day, not just midnight", () => {
    const fromMidnight = karachiInstant(new Date("2026-08-10T00:00:00.000Z"), 900);
    const fromMidday = karachiInstant(new Date("2026-08-10T09:23:11.000Z"), 900);
    assert.equal(fromMidnight.getTime(), fromMidday.getTime());
  });
});

describe("karachiWeekday", () => {
  it("returns ISO weekdays with Sunday as 7", () => {
    // 10 August 2026 is a Monday.
    assert.equal(karachiWeekday(new Date("2026-08-10T09:00:00.000Z")), 1);
    assert.equal(karachiWeekday(new Date("2026-08-15T09:00:00.000Z")), 6);
    assert.equal(karachiWeekday(new Date("2026-08-16T09:00:00.000Z")), 7);
  });

  it("uses the Karachi date when UTC is still on the previous day", () => {
    // 19:30 UTC Saturday is 00:30 Sunday in Karachi.
    assert.equal(karachiWeekday(new Date("2026-08-15T19:30:00.000Z")), 7);
  });
});

describe("workdays", () => {
  it("treats Sunday as off with the default configuration", () => {
    const workdays = parseWorkdays("1,2,3,4,5,6");
    assert.equal(isWorkday(new Date("2026-08-15T09:00:00.000Z"), workdays), true);
    assert.equal(isWorkday(new Date("2026-08-16T09:00:00.000Z"), workdays), false);
  });

  it("parses, de-duplicates and sorts, ignoring nonsense", () => {
    assert.deepEqual(parseWorkdays("1,2,3,4,5,6"), [1, 2, 3, 4, 5, 6]);
    assert.deepEqual(parseWorkdays("6,1,1,2"), [1, 2, 6]);
    assert.deepEqual(parseWorkdays("1, 2 ,3"), [1, 2, 3]);
    // Out-of-range and non-numeric values are dropped rather than guessed at.
    assert.deepEqual(parseWorkdays("0,8,9,x,,3"), [3]);
    assert.deepEqual(parseWorkdays(""), []);
  });
});

describe("formatting", () => {
  it("renders 12-hour clock times the way the UI shows them", () => {
    assert.equal(formatKarachiClock(0), "12:00 AM");
    assert.equal(formatKarachiClock(690), "11:30 AM");
    assert.equal(formatKarachiClock(720), "12:00 PM");
    assert.equal(formatKarachiClock(735), "12:15 PM");
    assert.equal(formatKarachiClock(16 * 60 + 12), "4:12 PM");
    assert.equal(formatKarachiClock(1320), "10:00 PM");
  });

  it("formats an instant and a window", () => {
    const from = new Date("2026-08-10T11:12:00.000Z"); // 16:12 Karachi
    const to = new Date("2026-08-10T12:12:00.000Z");
    assert.equal(formatKarachiTime(from), "4:12 PM");
    assert.equal(formatKarachiRange(from, to), "4:12 PM – 5:12 PM");
  });

  it("formats worked time", () => {
    assert.equal(formatDuration(0), "0m");
    assert.equal(formatDuration(45), "45m");
    assert.equal(formatDuration(462), "7h 42m");
    assert.equal(formatDuration(600), "10h 00m");
  });
});

describe("minutesBetween", () => {
  it("floors, and never returns a negative", () => {
    const start = new Date("2026-08-10T07:00:00.000Z");
    assert.equal(minutesBetween(start, new Date("2026-08-10T07:59:59.000Z")), 59);
    assert.equal(minutesBetween(start, new Date("2026-08-10T17:00:00.000Z")), 600);
    assert.equal(minutesBetween(start, new Date("2026-08-10T06:00:00.000Z")), 0);
  });
});

describe("karachiDay", () => {
  it("stores the Karachi date at UTC midnight", () => {
    assert.equal(
      karachiDay(new Date("2026-08-10T16:30:00.000Z")).toISOString(),
      "2026-08-10T00:00:00.000Z",
    );
    assert.equal(
      karachiDay(new Date("2026-08-10T19:30:00.000Z")).toISOString(),
      "2026-08-11T00:00:00.000Z",
    );
  });
});
