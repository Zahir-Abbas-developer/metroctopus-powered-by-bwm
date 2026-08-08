import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { fileDispute, monthlyDisputeStats } from "@/lib/disputes";
import { canResolveDispute } from "@/lib/permissions";
import { actorFor, podMemberIds } from "@/lib/permissions-service";
import { getSettings } from "@/lib/settings";

const fileSchema = z.object({
  scoreEventId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(20, "Make the case properly — a sentence or two on what actually happened")
    .max(2000),
});

/**
 * The dispute inbox, scoped to what the viewer may see.
 *
 * A member sees their own. The owner sees everything. A Service Lead sees the
 * ones they may rule on — which excludes disputes about charges they raised
 * themselves, because a lead judging their own charge is the self-approval
 * conflict one step removed.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const actor = await actorFor(user);
  const pod = actor.role === "ADMIN" ? [] : await podMemberIds(actor);
  const settings = await getSettings();

  const disputes = await prisma.dispute.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      user: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      resolvedBy: { select: { name: true } },
      scoreEvent: {
        select: {
          id: true,
          type: true,
          points: true,
          reason: true,
          createdAt: true,
          createdById: true,
          milestone: { select: { title: true } },
        },
      },
      files: { select: { id: true, filename: true, size: true } },
    },
  });

  const visible = disputes.filter((dispute) => {
    if (dispute.userId === user.id) return true;
    return canResolveDispute(actor, {
      subjectId: dispute.userId,
      inPod: pod.includes(dispute.userId),
      eventAuthorId: dispute.scoreEvent.createdById,
    }).allowed;
  });

  return NextResponse.json({
    slaHours: settings.disputeSlaHours,
    windowDays: settings.disputeWindowDays,
    stats: user.role === "ADMIN" ? await monthlyDisputeStats() : null,
    disputes: visible.map((dispute) => ({
      id: dispute.id,
      status: dispute.status,
      reason: dispute.reason,
      responseNote: dispute.responseNote,
      resolvedBy: dispute.resolvedBy?.name ?? null,
      resolvedAsLead: dispute.resolvedAsLead,
      resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
      createdAt: dispute.createdAt.toISOString(),
      waitingHours:
        dispute.status === "OPEN"
          ? Math.round((Date.now() - dispute.createdAt.getTime()) / 3_600_000)
          : null,
      member: dispute.user,
      files: dispute.files,
      event: {
        id: dispute.scoreEvent.id,
        type: dispute.scoreEvent.type,
        points: dispute.scoreEvent.points,
        reason: dispute.scoreEvent.reason,
        at: dispute.scoreEvent.createdAt.toISOString(),
        milestoneTitle: dispute.scoreEvent.milestone?.title ?? null,
      },
      // Whether *this* viewer may rule on it, so the UI never offers a button
      // the server would refuse.
      canResolve:
        dispute.status === "OPEN" &&
        canResolveDispute(actor, {
          subjectId: dispute.userId,
          inPod: pod.includes(dispute.userId),
          eventAuthorId: dispute.scoreEvent.createdById,
        }).allowed,
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

  const parsed = fileSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const result = await fileDispute({
    scoreEventId: parsed.data.scoreEventId,
    userId: user.id,
    reason: parsed.data.reason,
  });

  if (!result.ok) {
    return apiError(
      result.reason,
      409,
      result.field ? { [result.field]: result.reason } : undefined,
    );
  }

  return NextResponse.json(result, { status: 201 });
}
