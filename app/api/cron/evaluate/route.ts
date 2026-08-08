import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { runEvaluation } from "@/lib/evaluate";
import { sendOverdueAlert } from "@/lib/email/dispatch";
import { beginJob } from "@/lib/ops";

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

  const finish = await beginJob("evaluate");

  try {
    const result = await runEvaluation();
    // Only the scheduled run mails the owner; a manual run from the dashboard
    // shouldn't fire an alert at whoever pressed the button.
    const alert =
      auth.via === "secret"
        ? await sendOverdueAlert()
        : { status: "skipped" as const, reason: "manual run" };

    await finish(
      "OK",
      `${result.renewal.renewed.length} renewed · ${result.attendance.markedAbsent} absent · ${
        result.incentives ? `${result.incentives.bonuses.length} bonuses` : "no month close"
      }`,
    );

    return NextResponse.json({ ...result, overdueAlert: alert.status });
  } catch (error) {
    await finish("FAILED", error instanceof Error ? error.message : String(error));
    return apiError("The evaluation run failed", 500);
  }
}

/** Vercel Cron issues GET; same work, same guard. */
export async function GET(request: Request) {
  return POST(request);
}
