import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { authorizeCron } from "@/lib/cron-auth";
import { REPORT_TYPES, generateReports, type ReportType } from "@/lib/reports";
import { isAgencyFirstOfMonth, isAgencyMonday } from "@/lib/date";

const querySchema = z.object({
  /** Omit to let the calendar decide what is due today. */
  types: z.array(z.enum(REPORT_TYPES)).optional(),
});

/**
 * Report generation on a schedule.
 *
 * Called daily; it decides for itself what is due — weeklies on Monday,
 * monthlies on the 1st, both in agency time. That way the schedule can be a
 * single daily entry and the calendar logic lives in one place rather than in
 * a cron expression.
 *
 * Generation is idempotent, so a retried or duplicated invocation writes
 * nothing the first one already wrote.
 */
export async function POST(request: Request) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return auth.response;

  let requested: ReportType[] | undefined;
  try {
    const body = await request.json().catch(() => ({}));
    requested = querySchema.parse(body ?? {}).types;
  } catch {
    return apiError("Invalid request body", 400);
  }

  const now = new Date();
  const due: ReportType[] =
    requested ??
    [
      ...(isAgencyMonday(now) ? (["MEMBER_WEEKLY", "CLIENT_WEEKLY"] as const) : []),
      ...(isAgencyFirstOfMonth(now) ? (["MEMBER_MONTHLY"] as const) : []),
    ];

  if (due.length === 0) {
    return NextResponse.json({
      generated: 0,
      note: "Nothing due today — weeklies run on Monday, monthlies on the 1st.",
    });
  }

  try {
    const result = await generateReports({ types: due, reference: now });
    return NextResponse.json(result);
  } catch {
    return apiError("Report generation failed", 500);
  }
}

export async function GET(request: Request) {
  return POST(request);
}
