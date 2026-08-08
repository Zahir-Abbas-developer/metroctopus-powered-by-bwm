import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { recordSystemError } from "@/lib/system-errors";

/**
 * Where the error boundaries report to.
 *
 * The boundary is a client component, so it cannot write to the database
 * itself. It posts here instead, fire-and-forget — the page has already failed
 * and is showing the boundary; this call only decides whether the owner finds
 * out about it.
 *
 * What arrives depends on where the error happened. A client-side crash
 * carries a real message and stack, which is the class of failure that never
 * shows up in server logs at all. A server component failure in production
 * carries only Next's digest, which is still the handle that ties a report to
 * the matching line in the server log.
 */
export const dynamic = "force-dynamic";

const reportSchema = z.object({
  route: z.string().min(1).max(500),
  message: z.string().max(2_000).optional(),
  stack: z.string().max(20_000).optional(),
  digest: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  // Authenticated only. This endpoint writes rows, and an open one is a way to
  // fill the owner's error page with noise.
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Expected a JSON body", 400);
  }

  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return apiError("That isn't a valid error report", 400);

  await recordSystemError({
    route: parsed.data.route,
    message: parsed.data.message ?? "Client-side error",
    stack: parsed.data.stack ?? null,
    digest: parsed.data.digest ?? null,
    userId: user.id,
    userRole: user.role,
  });

  return NextResponse.json({ ok: true });
}
