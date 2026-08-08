import { NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/api";
import { pendingReviews, reviewStats } from "@/lib/review-sla";

/**
 * The owner's review queue and their own review record.
 *
 * Admin-only, and deliberately so: average review time is the owner's metric,
 * and putting it in front of the team would turn a tool for keeping the owner
 * honest into a stick for arguing about individual approvals.
 */
export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  const now = new Date();
  const [queue, stats] = await Promise.all([pendingReviews(now), reviewStats({ now })]);

  return NextResponse.json({
    serverNow: now.toISOString(),
    stats,
    queue: queue.map((row) => ({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
    })),
  });
}
