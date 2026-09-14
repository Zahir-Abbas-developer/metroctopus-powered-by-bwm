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
 * Scheduled daily at 13:00 UTC, which is 08:00 in New York in winter and 09:00
 * in summer.
 *
 * It was hourly, guarded to act only in the company's 9 o'clock hour, so the
 * time never drifted with daylight saving. **Vercel's Hobby plan allows only
 * daily crons**, so that design is not available here.
 *
 * The guard had to widen with it. Keeping `hour === 9` against a fixed daily UTC
 * time would have skipped the run *entirely* for half the year — the schedule
 * and the guard would disagree every spring, and the failure would be silence
 * rather than an error. A morning window fires year-round and accepts an hour of
 * seasonal drift, which is the honest trade at this plan level.
 *
 * On Pro, restore `0 * * * *` and narrow the window back to a single hour.
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

    // 8–10 rather than exactly 9: see the note above. Wide enough to survive the
    // daylight-saving shift, narrow enough that a mistimed or manual invocation
    // in the afternoon still does nothing.
    if (hour < 8 || hour > 10) {
      // Not an error, and not silence either: a cron whose logs say nothing is
      // indistinguishable from a cron that is not running.
      return NextResponse.json({
        status: "skipped",
        reason: "outside the morning window",
        hour,
        timeZone,
      });
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
