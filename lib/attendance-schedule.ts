import { randomInt } from "node:crypto";

import { karachiInstant, karachiMinutes } from "@/lib/attendance-time";

/**
 * Picking the hidden availability-check times.
 *
 * Pure apart from the entropy source, which is injectable so the tests can
 * drive it deterministically while production uses `node:crypto`. A predictable
 * generator would defeat the entire point of the feature: `Math.random()` is
 * seeded per process and its output is recoverable from a handful of samples,
 * which over a few weeks is exactly the kind of pattern a member could learn.
 *
 * The constraints, all configurable:
 *
 *   - no earlier than clock-in + 45 minutes, so nobody is checked the moment
 *     they arrive;
 *   - no later than 21:00, so a 60-minute window always closes by 22:00;
 *   - at least 90 minutes between consecutive checks, so three checks cannot
 *     land in the same twenty minutes and turn into one.
 */

export type ScheduleConfig = {
  /** How many checks to place. */
  count: number;
  /** Minutes past Karachi midnight — earliest a check may fall. */
  earliestMinutes: number;
  /** Minutes past Karachi midnight — latest a check may fall. */
  latestMinutes: number;
  /** Minimum minutes between consecutive checks. */
  minGapMinutes: number;
};

/** Injectable for tests. Returns an integer in [0, maxExclusive). */
export type RandomSource = (maxExclusive: number) => number;

/** Cryptographically random by default — see the note above. */
export const cryptoRandom: RandomSource = (maxExclusive) =>
  maxExclusive <= 1 ? 0 : randomInt(0, maxExclusive);

/**
 * How many checks actually fit in the available span.
 *
 * A late clock-in can leave too little room for the full count. Silently
 * placing fewer is the right behaviour — refusing to schedule at all would
 * mean a late arrival is never checked, which is backwards.
 */
export function feasibleCount(config: ScheduleConfig): number {
  const span = config.latestMinutes - config.earliestMinutes;
  if (span < 0) return 0;

  // k checks need (k-1) gaps between them.
  const fits = Math.floor(span / Math.max(1, config.minGapMinutes)) + 1;
  return Math.max(0, Math.min(config.count, fits));
}

/**
 * Random minutes-past-midnight for each check, ascending.
 *
 * Uses the standard reduction for "k ordered points with a minimum spacing":
 * subtract the mandatory gaps from the span, pick k uniform points in what
 * remains, sort, then add the gaps back. That draws uniformly from every valid
 * arrangement, rather than the biased result of picking one time and rejecting
 * neighbours until something fits.
 */
export function generateCheckMinutes(
  config: ScheduleConfig,
  random: RandomSource = cryptoRandom,
): number[] {
  const count = feasibleCount(config);
  if (count === 0) return [];

  const span = config.latestMinutes - config.earliestMinutes;
  const reserved = (count - 1) * config.minGapMinutes;
  const free = span - reserved;

  const offsets = Array.from({ length: count }, () => random(free + 1)).sort(
    (a, b) => a - b,
  );

  return offsets.map(
    (offset, index) =>
      config.earliestMinutes + offset + index * config.minGapMinutes,
  );
}

export type PlannedCheck = {
  scheduledAt: Date;
  windowEndsAt: Date;
};

/**
 * The concrete plan for one member's day: real instants, ready to store.
 *
 * `day` is any instant inside the Karachi day being scheduled.
 */
export function planChecksForDay(input: {
  day: Date;
  clockInAt: Date;
  config: ScheduleConfig;
  windowMinutes: number;
  random?: RandomSource;
}): PlannedCheck[] {
  const clockInMinutes = karachiMinutes(input.clockInAt);

  // The floor is whichever is later: the configured earliest, or clock-in plus
  // the offset. Someone arriving at 14:00 is not checked at 12:45.
  const earliest = Math.max(input.config.earliestMinutes, clockInMinutes);

  const minutes = generateCheckMinutes(
    { ...input.config, earliestMinutes: earliest },
    input.random,
  );

  return minutes.map((minute) => {
    const scheduledAt = karachiInstant(input.day, minute);
    return {
      scheduledAt,
      windowEndsAt: new Date(scheduledAt.getTime() + input.windowMinutes * 60_000),
    };
  });
}

/** Every constraint, in one place, so tests and callers agree on "valid". */
export function violatesConstraints(
  minutes: readonly number[],
  config: ScheduleConfig,
): string | null {
  for (const [index, minute] of minutes.entries()) {
    if (minute < config.earliestMinutes) {
      return `check ${index} at ${minute} is before the earliest ${config.earliestMinutes}`;
    }
    if (minute > config.latestMinutes) {
      return `check ${index} at ${minute} is after the latest ${config.latestMinutes}`;
    }
    if (index > 0) {
      const gap = minute - minutes[index - 1];
      if (gap < config.minGapMinutes) {
        return `checks ${index - 1} and ${index} are ${gap} apart, under the ${config.minGapMinutes} minimum`;
      }
    }
  }
  return null;
}
