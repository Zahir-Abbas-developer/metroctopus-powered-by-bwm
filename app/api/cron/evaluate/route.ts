import { NextResponse } from "next/server";

import { apiError, requireAdminApi } from "@/lib/api";
import { runEvaluation } from "@/lib/evaluate";

/**
 * The daily evaluation pass.
 *
 * Today it's triggered by the owner's "Run evaluation" button. When this moves
 * to a real schedule (Vercel Cron), the same handler serves it — a request
 * carrying the CRON_SECRET is accepted without a session, so the scheduler
 * doesn't need to log in.
 *
 * The pass is idempotent by construction, so an accidental double-trigger is
 * harmless.
 */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorized =
    secret !== undefined &&
    secret.length > 0 &&
    request.headers.get("authorization") === `Bearer ${secret}`;

  if (!authorized) {
    const { response } = await requireAdminApi();
    if (response) return response;
  }

  try {
    const result = await runEvaluation();
    return NextResponse.json(result);
  } catch {
    return apiError("The evaluation run failed", 500);
  }
}
