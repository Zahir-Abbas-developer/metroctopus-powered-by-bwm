/**
 * The single date utility for BWM (CLAUDE.md convention).
 *
 * Everything is stored in UTC and displayed in the company's working timezone.
 * No component should call `toLocaleDateString` or construct a date format
 * inline — import from here instead.
 *
 * Doctrine 6 makes the timezone a Company setting, defaulting to
 * `America/New_York`. This module holds that default; `companyTimezone()` in
 * lib/settings-timezone.ts reads the stored value for server code that must be
 * exact, chiefly the crons.
 *
 * The old fixed `AGENCY_UTC_OFFSET_HOURS = 5` is gone. Karachi is UTC+5 all
 * year, so a constant worked; New York is UTC-5 in winter and UTC-4 in summer,
 * and a constant would put every deadline an hour out for half the year. The
 * offset is now computed for the instant in question.
 */

export const COMPANY_TIMEZONE = "America/New_York";

/** @deprecated Use COMPANY_TIMEZONE. Kept so no import breaks silently. */
export const AGENCY_TIMEZONE = COMPANY_TIMEZONE;

type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

function isValid(date: Date): boolean {
  return !Number.isNaN(date.getTime());
}

function format(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (!isValid(date)) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: AGENCY_TIMEZONE,
    ...options,
  }).format(date);
}

/** "8 Aug 2026" — the default for table cells and metadata. */
export function formatDate(value: DateInput): string {
  return format(value, { day: "numeric", month: "short", year: "numeric" });
}

/** "8 August 2026" — for headers and detail pages. */
export function formatDateLong(value: DateInput): string {
  return format(value, { day: "numeric", month: "long", year: "numeric" });
}

/** "8 Aug 2026, 14:30" */
export function formatDateTime(value: DateInput): string {
  return format(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "August 2026" — retainer cycle labels. */
export function formatMonth(value: DateInput): string {
  return format(value, { month: "long", year: "numeric" });
}

/** "Friday" */
export function formatWeekday(value: DateInput): string {
  return format(value, { weekday: "long" });
}

/**
 * The current hour in the company's timezone, regardless of where the server or
 * the viewer's browser sits. Used for the dashboard greeting.
 */
export function companyHour(
  now: DateInput = new Date(),
  timeZone: string = COMPANY_TIMEZONE,
): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  }).format(toDate(now));
  return Number.parseInt(hour, 10);
}

/** "Good morning" | "Good afternoon" | "Good evening", in agency time. */
/** @deprecated Use companyHour. */
export const agencyHour = companyHour;

export function greeting(now: DateInput = new Date()): string {
  const hour = agencyHour(now);
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** "Joined 2 months ago" style relative text, coarse by design. */
export function relativeFromNow(value: DateInput, now: DateInput = new Date()): string {
  const date = toDate(value);
  if (!isValid(date)) return "—";

  const diffMs = toDate(now).getTime() - date.getTime();
  const past = diffMs >= 0;
  const abs = Math.abs(diffMs);

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const month = 30 * day;
  const year = 365 * day;

  const pick = (): [number, Intl.RelativeTimeFormatUnit] => {
    if (abs < hour) return [Math.round(abs / minute), "minute"];
    if (abs < day) return [Math.round(abs / hour), "hour"];
    if (abs < month) return [Math.round(abs / day), "day"];
    if (abs < year) return [Math.round(abs / month), "month"];
    return [Math.round(abs / year), "year"];
  };

  const [value_, unit] = pick();
  if (unit === "minute" && value_ < 1) return "just now";

  return new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" }).format(
    past ? -value_ : value_,
    unit,
  );
}

// ---------------------------------------------------------------------------
// Date-only fields and deadlines
// ---------------------------------------------------------------------------

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How far ahead of UTC a zone is at a given instant, in hours.
 *
 * Derived from `Intl` rather than a table, so daylight saving is handled by the
 * platform's own tz database instead of by an assumption that goes stale twice
 * a year. Returns a positive number east of UTC (Karachi +5), negative west
 * (New York -5, or -4 while on daylight time).
 */
export function utcOffsetHours(
  at: DateInput = new Date(),
  timeZone: string = COMPANY_TIMEZONE,
): number {
  const date = toDate(at);
  if (!isValid(date)) return 0;

  // Read the wall-clock time in the zone, then measure it against the same
  // instant expressed in UTC.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    // Intl renders midnight as hour 24 in some engines under hour12:false.
    get("hour") % 24,
    get("minute"),
    get("second"),
  );

  return Math.round((asUtc - date.getTime()) / (60 * 60 * 1000));
}

/**
 * `startDate`, `endDate` and `dueDate` are date-only. They're stored at UTC
 * midnight of the intended calendar day. Formatting reads them back in the
 * company timezone, so a zone *behind* UTC — New York is — would render UTC
 * midnight as the previous evening; every formatter here works from the stored
 * calendar day rather than the instant, which is why that does not happen.
 */
export function toDateOnly(value: DateInput): Date {
  const date = toDate(value);
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

/** Parse a `YYYY-MM-DD` value from an `<input type="date">`. */
export function parseDateInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Format a Date back into a `YYYY-MM-DD` value for an `<input type="date">`. */
export function toDateInput(value: DateInput): string {
  const date = toDateOnly(value);
  return date.toISOString().slice(0, 10);
}

export function addDays(value: DateInput, days: number): Date {
  return new Date(toDate(value).getTime() + days * DAY_MS);
}

/**
 * The instant a due item is actually late.
 *
 * A due date means "by the end of that day, in the company's timezone". The
 * date is stored at UTC midnight, so the deadline is the following local
 * midnight expressed in UTC. Scoring and overdue chips use this, never the raw
 * stored date, or everything due today would read as late from the small hours
 * onwards.
 *
 * The offset is measured at the end of that day rather than assumed, so a
 * deadline falling either side of a daylight-saving change lands on the real
 * local midnight.
 */
export function dueDeadline(
  dueDate: DateInput,
  timeZone: string = COMPANY_TIMEZONE,
): Date {
  const startOfDayUtc = toDateOnly(dueDate).getTime();
  const approximateEnd = startOfDayUtc + DAY_MS;
  const offset = utcOffsetHours(approximateEnd, timeZone);
  return new Date(approximateEnd - offset * 60 * 60 * 1000);
}

/** Whole days from now until `value`; negative once it's in the past. */
export function daysUntil(value: DateInput, now: DateInput = new Date()): number {
  return Math.ceil((toDate(value).getTime() - toDate(now).getTime()) / DAY_MS);
}

/** Inclusive whole-day span between two date-only values. */
export function daysBetween(from: DateInput, to: DateInput): number {
  return Math.round(
    (toDateOnly(to).getTime() - toDateOnly(from).getTime()) / DAY_MS,
  );
}

export type DueUrgency = "overdue" | "soon" | "normal";

/**
 * Deadline pressure for a milestone that isn't finished yet: red once the
 * deadline has passed, amber inside the final 48 hours.
 */
export function dueUrgency(
  dueDate: DateInput,
  now: DateInput = new Date(),
): DueUrgency {
  const remaining = dueDeadline(dueDate).getTime() - toDate(now).getTime();
  if (remaining < 0) return "overdue";
  if (remaining <= 48 * 60 * 60 * 1000) return "soon";
  return "normal";
}

// ---------------------------------------------------------------------------
// Reporting periods
// ---------------------------------------------------------------------------

/**
 * The calendar date in agency time, as UTC midnight of that same day.
 *
 * Everything below works from this: take "what day is it in Karachi", then do
 * plain UTC arithmetic. Doing it the other way round — arithmetic first,
 * timezone second — is what produces off-by-one weeks near midnight.
 */
export function agencyDay(value: DateInput = new Date()): Date {
  const iso = agencyToday(value);
  return new Date(`${iso}T00:00:00.000Z`);
}

/** Monday of the week containing `value`, as a date-only value. */
export function startOfAgencyWeek(value: DateInput = new Date()): Date {
  const day = agencyDay(value);
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day of the week.
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
}

/** Sunday of the week containing `value`, as a date-only value. */
export function endOfAgencyWeek(value: DateInput = new Date()): Date {
  return addDays(startOfAgencyWeek(value), 6);
}

/** The 1st of the month containing `value`. */
export function startOfAgencyMonth(value: DateInput = new Date()): Date {
  const day = agencyDay(value);
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 1));
}

/** The last day of the month containing `value`. */
export function endOfAgencyMonth(value: DateInput = new Date()): Date {
  const day = agencyDay(value);
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0));
}

/** True when `value` falls on a Monday in agency time. */
export function isAgencyMonday(value: DateInput = new Date()): boolean {
  return agencyDay(value).getUTCDay() === 1;
}

/** True when `value` is the first of the month in agency time. */
export function isAgencyFirstOfMonth(value: DateInput = new Date()): boolean {
  return agencyDay(value).getUTCDate() === 1;
}

/** "4 – 10 Aug 2026" / "August 2026" — the label on a report header. */
export function formatPeriod(start: DateInput, end: DateInput): string {
  const from = toDateOnly(start);
  const to = toDateOnly(end);

  const sameMonth =
    from.getUTCFullYear() === to.getUTCFullYear() &&
    from.getUTCMonth() === to.getUTCMonth();

  // A period covering a whole calendar month reads better as the month itself.
  if (sameMonth && from.getUTCDate() === 1 && to.getUTCDate() === endOfAgencyMonth(from).getUTCDate()) {
    return formatMonth(from);
  }

  if (sameMonth) {
    const day = new Intl.DateTimeFormat("en-GB", {
      timeZone: AGENCY_TIMEZONE,
      day: "numeric",
    }).format(from);
    return `${day} – ${formatDate(to)}`;
  }

  return `${formatDate(from)} – ${formatDate(to)}`;
}

/** The calendar month a score cycle belongs to, in agency time. */
export function agencyYearMonth(value: DateInput = new Date()): {
  year: number;
  month: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AGENCY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(toDate(value));

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  return { year, month };
}

/** The month before the given cycle, rolling the year over at January. */
export function previousYearMonth(cycle: { year: number; month: number }): {
  year: number;
  month: number;
} {
  return cycle.month === 1
    ? { year: cycle.year - 1, month: 12 }
    : { year: cycle.year, month: cycle.month - 1 };
}

/** "August 2026" from a `{ year, month }` cycle. */
export function formatCycle(cycle: { year: number; month: number }): string {
  return formatMonth(new Date(Date.UTC(cycle.year, cycle.month - 1, 1)));
}

/** Today's date in agency time as an ISO `YYYY-MM-DD` string. */
export function agencyToday(now: DateInput = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: AGENCY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(toDate(now));
  return parts;
}
