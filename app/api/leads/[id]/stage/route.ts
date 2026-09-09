import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { canUseDepartment } from "@/lib/departments";
import { moveLeadStage } from "@/lib/stages";
import { hasAdminPower } from "@/lib/constants";

/**
 * Move a lead to another stage.
 *
 * One endpoint for every way a card can move — a drag on the board, the drawer,
 * a script — because the rules a move implies (a reason on LOST, the lifecycle
 * flip, the activity entry, the notification) must not depend on which surface
 * triggered it. `moveLeadStage` in lib/stages.ts owns all of them.
 */

const bodySchema = z.object({
  stage: z.string().trim().min(1, "Pick a stage"),
  lostReason: z.string().trim().max(120).nullish(),
  lostNote: z.string().trim().max(2000).nullish(),
});

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Pick a stage", 422, { stage: "Pick a stage" });
  }

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { id: true, departmentId: true, ownerId: true },
  });
  if (!lead) return apiError("That lead no longer exists", 404);

  const isAdmin = hasAdminPower(user.role);

  // Two gates, and they are different questions. Department membership decides
  // whether this business line is yours at all; ownership decides whether this
  // particular deal is. A member of the department who does not own the deal
  // can see it on the board but may not move it.
  if (!(await canUseDepartment(user.id, isAdmin, lead.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }
  if (!isAdmin && lead.ownerId !== user.id) {
    return apiError("Only the owner of this deal can move it", 403);
  }

  const result = await moveLeadStage({
    leadId: lead.id,
    toStageKey: parsed.data.stage,
    actorId: user.id,
    lostReason: parsed.data.lostReason,
    lostNote: parsed.data.lostNote,
  });

  if (!result.ok) {
    return apiError(
      result.error,
      result.status,
      result.field ? { [result.field]: result.error } : undefined,
    );
  }

  return NextResponse.json({
    stage: result.stage,
    converted: result.converted,
  });
}
