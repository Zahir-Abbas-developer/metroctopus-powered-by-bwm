import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { actorFor } from "@/lib/permissions-service";
import { pendingReviews, reviewStats, reviewTimesByReviewer } from "@/lib/review-sla";

/**
 * The review queue, scoped to whoever is asking.
 *
 * The owner sees everything and every reviewer's average time. A service lead
 * sees their own lines and their own queue — not the whole agency's, and not
 * anyone else's average, because average review time is a tool for keeping the
 * person holding the queue honest, not a stick for arguing about someone
 * else's approvals.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const actor = await actorFor(user);
  // A lead sees their lines; the owner sees everything.
  const viewerId = actor.role === "ADMIN" ? undefined : user.id;

  if (actor.role !== "ADMIN" && actor.leadServiceIds.length === 0) {
    return apiError("Only the agency owner or a service lead has a review queue", 403);
  }

  const now = new Date();
  const [queue, stats, reviewers] = await Promise.all([
    pendingReviews(now, viewerId),
    reviewStats({ now, viewerId }),
    actor.role === "ADMIN" ? reviewTimesByReviewer() : Promise.resolve([]),
  ]);

  return NextResponse.json({
    serverNow: now.toISOString(),
    stats,
    // Every reviewer's average, not only the owner's. A lead who sits on
    // approvals does the same damage the owner was doing before Phase 8.
    reviewers,
    viewer: { id: user.id, isAdmin: actor.role === "ADMIN" },
    queue: queue.map((row) => ({
      ...row,
      submittedAt: row.submittedAt.toISOString(),
    })),
  });
}
