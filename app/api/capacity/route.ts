import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { candidatesForWeek, loadGrid } from "@/lib/capacity-service";

/**
 * Who has room, and when.
 *
 * Two shapes from one route because they answer the same question at
 * different zooms: `?dueDate=` returns everyone's load in that one week plus a
 * suggestion (the assignment controls), and `?weeks=` returns the grid (the
 * utilization view).
 *
 * Readable by any signed-in user. A member seeing that a colleague is at 110%
 * is the point — it is what stops work being handed over without a thought.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const dueDate = searchParams.get("dueDate");

  if (dueDate) {
    const parsed = new Date(dueDate);
    if (Number.isNaN(parsed.getTime())) {
      return apiError("That date didn't parse", 422, { dueDate: "Invalid date" });
    }

    const estimatedHours = Number(searchParams.get("estimatedHours") ?? "2");

    return NextResponse.json(
      await candidatesForWeek({
        dueDate: parsed,
        serviceSlug: searchParams.get("serviceSlug"),
        estimatedHours: Number.isFinite(estimatedHours) ? estimatedHours : 2,
        excludeMilestoneId: searchParams.get("excludeMilestoneId"),
      }),
    );
  }

  const weeks = Math.min(16, Math.max(1, Number(searchParams.get("weeks") ?? "8")));
  const fromParam = searchParams.get("from");
  const from = fromParam ? new Date(fromParam) : new Date();
  if (Number.isNaN(from.getTime())) {
    return apiError("That date didn't parse", 422, { from: "Invalid date" });
  }

  return NextResponse.json({
    from: from.toISOString(),
    weeks,
    grid: await loadGrid({ from, weeks }),
  });
}
