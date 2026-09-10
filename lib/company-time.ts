import { getSettings } from "@/lib/settings";
import { COMPANY_TIMEZONE, companyHour, dueDeadline } from "@/lib/date";

/**
 * The company clock, read from the database.
 *
 * `lib/date.ts` holds the default and does the arithmetic; it cannot read the
 * setting itself because it is imported by client components, where an async
 * database call is not available. Server code that must be exact — the crons
 * above all, which decide *when* something fires — comes through here instead.
 */

export async function companyTimezone(): Promise<string> {
  try {
    const settings = await getSettings();
    // An empty or unparseable zone would make every downstream Intl call throw;
    // falling back is better than a cron that dies at 9am.
    return isValidZone(settings.timezone) ? settings.timezone : COMPANY_TIMEZONE;
  } catch {
    return COMPANY_TIMEZONE;
  }
}

function isValidZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The current hour (0–23) on the company clock. */
export async function currentCompanyHour(now: Date = new Date()): Promise<number> {
  return companyHour(now, await companyTimezone());
}

/** The instant a due date becomes late, on the company clock. */
export async function companyDueDeadline(dueDate: Date | string): Promise<Date> {
  return dueDeadline(dueDate, await companyTimezone());
}
