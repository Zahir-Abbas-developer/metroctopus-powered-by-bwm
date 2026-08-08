import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { runEvaluation } from "@/lib/evaluate";
import { sendOverdueAlert } from "@/lib/email/dispatch";

/**
 * The daily pass: deadline notices, catch-up scoring, project close-out, and
 * the reports whose cadence falls due today.
 *
 * Triggered by Vercel Cron with a CRON_SECRET bearer token, or by the owner's
 * "Run evaluation" button. Idempotent by construction, so an accidental double
 * trigger changes nothing.
 */
export async function POST(request: Request) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return auth.response;

  try {
    const result = await runEvaluation();
    // Only the scheduled run mails the owner; a manual run from the dashboard
    // shouldn't fire an alert at whoever pressed the button.
    const alert =
      auth.via === "secret"
        ? await sendOverdueAlert()
        : { status: "skipped" as const, reason: "manual run" };

    return NextResponse.json({ ...result, overdueAlert: alert.status });
  } catch {
    return apiError("The evaluation run failed", 500);
  }
}

/** Vercel Cron issues GET; same work, same guard. */
export async function GET(request: Request) {
  return POST(request);
}
