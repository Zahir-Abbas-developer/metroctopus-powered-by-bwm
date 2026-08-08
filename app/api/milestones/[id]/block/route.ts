import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { BLOCK_REASONS, blockMilestone, unblockMilestone } from "@/lib/blocking";

/**
 * Blocking and unblocking. Separate from the status route because the clock
 * has to be opened and closed atomically with the status change — dragging a
 * card out of BLOCKED through the generic endpoint would silently lose the
 * pause it earned.
 */

const blockSchema = z.object({
  reason: z.enum(BLOCK_REASONS),
  note: z
    .string()
    .trim()
    .min(10, "Say what you're waiting on — the owner has to be able to act on it")
    .max(500, "Keep it under 500 characters"),
  blockingMilestoneId: z.string().min(1).nullish(),
});

const unblockSchema = z.object({
  /** Owner-only: the block wasn't legitimate, so it buys no time. */
  veto: z.boolean().optional(),
  vetoNote: z.string().trim().max(500).nullish(),
});

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = blockSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    select: { assigneeId: true },
  });
  if (!milestone) return apiError("That milestone no longer exists", 404);

  // Members block their own work — that is the point of the feature. They
  // should not need to ask permission to stop a clock they cannot advance.
  if (user.role !== "ADMIN" && milestone.assigneeId !== user.id) {
    return apiError("You can only block milestones assigned to you", 403);
  }

  const result = await blockMilestone({
    milestoneId: params.id,
    actorId: user.id,
    reason: parsed.data.reason,
    note: parsed.data.note,
    blockingMilestoneId: parsed.data.blockingMilestoneId ?? null,
  });

  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({ ok: true, blockPeriodId: result.blockPeriodId }, { status: 201 });
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An unblock with no body is the normal case.
  }

  const parsed = unblockSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    select: { assigneeId: true },
  });
  if (!milestone) return apiError("That milestone no longer exists", 404);

  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && milestone.assigneeId !== user.id) {
    return apiError("You can only unblock milestones assigned to you", 403);
  }

  if (parsed.data.veto && !isAdmin) {
    return apiError("Only the agency owner can overrule a block", 403);
  }
  if (parsed.data.veto && (parsed.data.vetoNote?.trim().length ?? 0) < 5) {
    return apiError("Say why the block doesn't stand — it goes to the member", 422, {
      vetoNote: "A written reason is required",
    });
  }

  const result = await unblockMilestone({
    milestoneId: params.id,
    actorId: user.id,
    vetoed: parsed.data.veto,
    vetoNote: parsed.data.vetoNote ?? null,
  });

  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json({ ok: true, minutesAdded: result.minutes });
}
