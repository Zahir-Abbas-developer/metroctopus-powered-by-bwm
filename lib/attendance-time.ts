/**
 * Wall-clock arithmetic in the agency's timezone.
 *
 * Pure: no database, no `new Date()` without an argument. Every function takes
 * the instant it should reason about, which is what lets the tests simulate a
 * device in Tokyo or Los Angeles and assert the answers are identical.
 *
 * The whole attendance system reasons in "minutes past Karachi midnight". A
 * device's own timezone is never consulted — a member in a different timezone,
 * or one who changes their system clock, gets exactly the same shift.
 *
 * Asia/Karachi is UTC+5 all year and observes no daylight saving, so the offset
 * is a constant rather than a lookup. That is asserted in the tests, because if
 * Pakistan ever reintroduces DST this is the assumption that breaks.
 */

export const KARACHI_UTC_OFFSET_MINUTES = 5 * 60;

const MINUTE_MS = 60_000;
const DAY_MINUTES = 24 * 60;

/** The Karachi calendar date of an instant, as `YYYY-MM-DD`. */
export function karachiDateString(instant: Date): string {
  const shifted = new Date(instant.getTime() + KARACHI_UTC_OFFSET_MINUTES * MINUTE_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The Karachi calendar date of an instant, as UTC midnight — the storage
 * convention for every date-only column in this schema.
 */
export function karachiDay(instant: Date): Date {
  return new Date(`${karachiDateString(instant)}T00:00:00.000Z`);
}

/** Minutes past Karachi midnight, 0–1439. */
export function karachiMinutes(instant: Date): number {
  const shifted = new Date(instant.getTime() + KARACHI_UTC_OFFSET_MINUTES * MINUTE_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/**
 * The instant at which a given Karachi wall-clock time occurs on a given day.
 *
 * `minutes` may exceed 1440 or go negative; the result rolls into the next or
 * previous day, which keeps callers from having to special-case a shift that
 * crosses midnight.
 */
export function karachiInstant(day: Date, minutes: number): Date {
  const midnightUtc = karachiDay(day).getTime();
  return new Date(midnightUtc + (minutes - KARACHI_UTC_OFFSET_MINUTES) * MINUTE_MS);
}

/** ISO weekday in Karachi: 1 = Monday … 7 = Sunday. */
export function karachiWeekday(instant: Date): number {
  const shifted = new Date(instant.getTime() + KARACHI_UTC_OFFSET_MINUTES * MINUTE_MS);
  const day = shifted.getUTCDay();
  return day === 0 ? 7 : day;
}

/** True when the given instant falls on a configured working day. */
export function isWorkday(instant: Date, workdays: readonly number[]): boolean {
  return workdays.includes(karachiWeekday(instant));
}

/** "1,2,3,4,5,6" -> [1,2,3,4,5,6]. Invalid entries are dropped, not guessed. */
export function parseWorkdays(value: string): number[] {
  return [
    ...new Set(
      value
        .split(",")
        .map((part) => Number.parseInt(part.trim(), 10))
        .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
    ),
  ].sort();
}

/** "4:12 PM" — the format used in score-event reasons and the UI. */
export function formatKarachiClock(minutes: number): string {
  const normalised = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hours24 = Math.floor(normalised / 60);
  const mins = normalised % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/** Same, from an instant. */
export function formatKarachiTime(instant: Date): string {
  return formatKarachiClock(karachiMinutes(instant));
}

/** "4:12 PM – 5:12 PM", for a check's window. */
export function formatKarachiRange(from: Date, to: Date): string {
  return `${formatKarachiTime(from)} – ${formatKarachiTime(to)}`;
}

/** Whole minutes between two instants, floored and never negative. */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / MINUTE_MS));
}

/** "7h 42m" — worked time, for the day summary. */
export function formatDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
