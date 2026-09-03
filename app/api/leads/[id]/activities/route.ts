import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { logActivity } from "@/lib/pipeline";
import { ACTIVITY_TYPES } from "@/lib/pipeline-types";
import { hasAdminPower } from "@/lib/constants";

const activitySchema = z.object({
  type: z.enum(ACTIVITY_TYPES),
  note: z
    .string()
    .trim()
    .min(3, "A few words on what happened — this is the record")
    .max(1000),
  /** Defaults to now; set when logging something after the fact. */
  occurredAt: z.string().datetime().optional(),
});

/**
 * Logging sales work.
 *
 * Anyone signed in can log against any lead: a delivery member who takes a
 * call on a prospect should be able to record it, and the activity counts
 * towards *their* targets, not the lead owner's. That is why the userId comes
 * from the session rather than from the lead.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = activitySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, stage: true },
  });
  if (!lead) return apiError("That lead no longer exists", 404);

  if (lead.stage === "WON" || lead.stage === "LOST") {
    return apiError("That deal is closed — reopen it first if there's more to log", 409);
  }

  const occurredAt = parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : new Date();
  if (occurredAt > new Date(Date.now() + 60_000)) {
    return apiError("You can't log work that hasn't happened yet", 422, {
      occurredAt: "Must be in the past",
    });
  }

  const activity = await logActivity({
    leadId: lead.id,
    userId: user.id,
    type: parsed.data.type,
    note: parsed.data.note,
    occurredAt,
  });

  const after = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: { stage: true },
  });

  return NextResponse.json(
    {
      activity,
      // The client re-renders the card if logging advanced the stage.
      stage: after?.stage ?? lead.stage,
      stageAdvanced: after?.stage !== lead.stage,
    },
    { status: 201 },
  );
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let activityId: string | null = null;
  try {
    activityId = ((await request.json()) as { activityId?: string })?.activityId ?? null;
  } catch {
    // Falls through to the 422 below.
  }
  if (!activityId) return apiError("Which activity?", 422, { activityId: "Required" });

  const activity = await prisma.salesActivity.findUnique({
    where: { id: activityId },
    select: { userId: true, leadId: true },
  });
  if (!activity || activity.leadId !== params.id) {
    return apiError("That activity no longer exists", 404);
  }

  // Own work only, unless you're the owner. Activity counts feed scoring, so
  // deleting someone else's log would be editing their score.
  if (!hasAdminPower(user.role) && activity.userId !== user.id) {
    return apiError("You can only remove your own logged activity", 403);
  }

  await prisma.salesActivity.delete({ where: { id: activityId } });
  return NextResponse.json({ ok: true });
}
