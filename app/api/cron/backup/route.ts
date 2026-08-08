import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { runBackup } from "@/lib/backup";
import { beginJob } from "@/lib/ops";

/**
 * The nightly backup, on its own schedule.
 *
 * Separate from /api/cron/evaluate so a slow dump can't push the evaluation
 * pass past a serverless timeout, and so a failing backup doesn't take the
 * whole nightly run with it.
 */
export async function POST(request: Request) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return auth.response;

  const finish = await beginJob("backup");

  try {
    const result = await runBackup();
    await finish(result.status === "FAILED" ? "FAILED" : "OK", result.error ?? `${result.status} · ${result.sizeBytes ?? 0} bytes`);
    return NextResponse.json(result);
  } catch (error) {
    await finish("FAILED", error instanceof Error ? error.message : String(error));
    return apiError("The backup run failed", 500);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
