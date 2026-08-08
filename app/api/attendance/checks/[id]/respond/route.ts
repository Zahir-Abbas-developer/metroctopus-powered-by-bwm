import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { respondToCheck } from "@/lib/attendance";

/** "I'm available" — the one action that passes a check. */
export async function POST(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const result = await respondToCheck(user.id, params.id);
  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({ ok: true, responseSeconds: result.responseSeconds });
}
