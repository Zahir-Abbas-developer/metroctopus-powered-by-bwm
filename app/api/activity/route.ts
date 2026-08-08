import { NextResponse } from "next/server";

import { apiError, requireAdminApi } from "@/lib/api";
import { recentActivity } from "@/lib/activity";

/** The workspace feed. Owner-only: it spans everyone's work by definition. */
export async function GET(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const take = Number(new URL(request.url).searchParams.get("take") ?? 20);

  try {
    const activity = await recentActivity(Math.min(Math.max(take, 1), 100));
    return NextResponse.json({ activity });
  } catch {
    return apiError("Couldn't load the activity feed", 500);
  }
}
