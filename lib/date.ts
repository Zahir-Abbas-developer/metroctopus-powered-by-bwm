/**
 * The single date utility for Agency OS (CLAUDE.md convention).
 *
 * Everything is stored in UTC and displayed in the agency's working timezone,
 * Asia/Karachi. No component should call `toLocaleDateString` or construct a
 * date format inline — import from here instead, so a timezone change is a
 * one-line edit.
 */

export const AGENCY_TIMEZONE = "Asia/Karachi";

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
 * The current hour in Asia/Karachi, regardless of where the server or the
 * viewer's browser sits. Used for the dashboard greeting.
 */
export function agencyHour(now: DateInput = new Date()): number {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: AGENCY_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).format(toDate(now));
  return Number.parseInt(hour, 10);
}

/** "Good morning" | "Good afternoon" | "Good evening", in agency time. */
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
