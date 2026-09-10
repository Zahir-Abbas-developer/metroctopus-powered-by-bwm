import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { viewerFor } from "@/lib/viewer";
import { metricsFor, RANGE_PRESETS, type RangePreset } from "@/lib/analytics";

/**
 * The dashboard's figures.
 *
 * Every number is computed in `lib/analytics.ts` against the viewer's own
 * departments. Nothing is filtered here and nothing is filtered in the
 * component: an aggregate is a disclosure like any other, and a total computed
 * over records the viewer cannot open is a leak with a number in front of it.
 *
 * The `departmentId` parameter can only narrow what the viewer may already see.
 * `metricsFor` ignores one they do not belong to rather than trusting it —
 * a query string is not a permission.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("preset");
  const preset: RangePreset =
    requested && (RANGE_PRESETS as readonly string[]).includes(requested)
      ? (requested as RangePreset)
      : "THIS_MONTH";

  const viewer = await viewerFor(user);

  const analytics = await metricsFor(viewer, {
    departmentId: searchParams.get("departmentId"),
    memberId: searchParams.get("memberId"),
    preset,
    from: searchParams.get("from"),
    to: searchParams.get("to"),
  });

  return NextResponse.json(analytics);
}
