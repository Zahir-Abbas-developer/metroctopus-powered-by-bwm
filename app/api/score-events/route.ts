import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, manualAdjustSchema } from "@/lib/validation";
import { agencyYearMonth } from "@/lib/date";

/**
 * A manual adjustment to someone's score.
 *
 * The written reason is mandatory and stored on the event itself — these show
 * up distinctly in the member's ledger, so a hand-applied change is always
 * attributable to the person who made it.
 */
export async function POST(request: Request) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = manualAdjustSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const target = await prisma.user.findUnique({ where: { id: parsed.data.userId } });
  if (!target) return apiError("That team member no longer exists", 404);

  const now = new Date();
  const cycle = agencyYearMonth(now);

  try {
    const event = await prisma.scoreEvent.create({
      data: {
        userId: target.id,
        type: "MANUAL_ADJUST",
        points: parsed.data.points,
        reason: parsed.data.reason,
        year: cycle.year,
        month: cycle.month,
        // No dedupe key: adjustments are deliberate, repeatable acts.
        dedupeKey: null,
        createdById: admin!.id,
      },
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch {
    return apiError("Couldn't record that adjustment", 500);
  }
}
