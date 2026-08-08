import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { breakStateFor, endBreak, startBreak } from "@/lib/attendance";
import { BREAK_REASONS } from "@/lib/fairness-windows";

/**
 * Protected break time.
 *
 * GET returns the member's own state and what is left of the daily allowance.
 * Nothing here is ever scoped to another user: a member's break history is
 * theirs, and the owner sees it through the live board instead.
 */

const startSchema = z.object({ reason: z.enum(BREAK_REASONS) });

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const state = await breakStateFor(user.id);

  return NextResponse.json({
    serverNow: new Date().toISOString(),
    open: state.open
      ? {
          id: state.open.id,
          reason: state.open.reason,
          startedAt: state.open.startedAt.toISOString(),
        }
      : null,
    allowance: state.allowance,
    sessions: state.sessions.map((session) => ({
      id: session.id,
      reason: session.reason,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      minutes: session.minutes,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Pick what the break is for", 422, fieldErrors(parsed.error));
  }

  const result = await startBreak(user.id, parsed.data.reason);
  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({ ok: true, id: result.id }, { status: 201 });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const result = await endBreak(user.id);
  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({
    ok: true,
    minutes: result.minutes,
    checksShifted: result.checksShifted,
    checksDropped: result.checksDropped,
  });
}
