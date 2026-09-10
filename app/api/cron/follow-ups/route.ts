import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { dueFollowUps } from "@/lib/tasks";
import { companyTimezone } from "@/lib/company-time";
import { companyHour, formatDate } from "@/lib/date";
import { notify } from "@/lib/notifications";

/**
 * The 9am follow-up call.
 *
 * Runs hourly and does its work only in the company's 9 o'clock hour, rather
 * than being scheduled at a fixed UTC time. A cron pinned to 14:00 UTC is 9am in
 * New York for half the year and 10am for the other half — the hour moves
 * twice a year and nobody would connect the drift to daylight saving.
 *
 * Deduped per record per day, so a retry, a second Vercel region, or an hour
 * that runs twice on the night the clocks go back cannot send the same person
 * the same reminder twice.
 */
export async function POST(request: Request) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const now = new Date();
    const timeZone = await companyTimezone();
    const hour = companyHour(now, timeZone);

    if (hour !== 9) {
      // Not an error, and not silence either: a cron whose logs say nothing is
      // indistinguishable from a cron that is not running.
      return NextResponse.json({ status: "skipped", reason: "not 9am", hour, timeZone });
    }

    const due = await dueFollowUps(now);
    let sent = 0;

    for (const followUp of due) {
      const delivered = await notify({
        userId: followUp.userId,
        type: "FOLLOW_UP_DUE",
        title: `Follow up with ${followUp.name}`,
        body: `${followUp.department} — due ${formatDate(followUp.dueAt)}`,
        href:
          followUp.type === "LEAD"
            ? `/pipeline?lead=${followUp.recordId}`
            : `/clients/${followUp.recordId}`,
        dedupeKey: `follow-up:${followUp.recordId}:${todayKey(now, timeZone)}`,
      });
      if (delivered) sent += 1;
    }

    return NextResponse.json({
      status: "ok",
      timeZone,
      due: due.length,
      sent,
      // due minus sent is the dedupe working, not a failure.
      skipped: due.length - sent,
    });
  } catch {
    return apiError("The follow-up run failed", 500);
  }
}

export async function GET(request: Request) {
  return POST(request);
}

/** `YYYY-MM-DD` on the company clock — the dedupe window is a company day. */
function todayKey(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  return parts;
}

// Deliberately not gated on a module flag, unlike every other cron in this
// folder: follow-ups are core CRM, not one of the four parked modules.
export const dynamic = "force-dynamic";
