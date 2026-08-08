import { NextResponse } from "next/server";

import { healthReport } from "@/lib/ops";

/**
 * Liveness and freshness, in one place.
 *
 * Deliberately **unauthenticated**: an uptime monitor cannot hold a session,
 * and a health endpoint behind auth is one that only tells you the truth when
 * you're already logged in and looking.
 *
 * It leaks nothing beyond "the database answered" and "a job ran N hours ago"
 * — no counts, no names, no data. The one thing it deliberately does *not* do
 * is return 500 when the database is fine but a backup is late: that would
 * page someone about a stale snapshot as though the app were down.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const report = await healthReport();

  return NextResponse.json(report, {
    // Degraded is a 200 with a body that says so. Only a dead database is a 503.
    status: report.database.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
