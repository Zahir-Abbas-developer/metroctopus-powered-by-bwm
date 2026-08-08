import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { resolveDispute } from "@/lib/disputes";
import { canResolveDispute } from "@/lib/permissions";
import { actorFor, podMemberIds } from "@/lib/permissions-service";

const rulingSchema = z.object({
  status: z.enum(["UPHELD", "REVERSED"]),
  responseNote: z
    .string()
    .trim()
    .min(10, "Say why — a decision with no reasoning is the thing this replaces")
    .max(2000),
});

/**
 * The ruling.
 *
 * A written response is mandatory on **either** outcome. Upholding a charge in
 * silence is exactly the behaviour formal disputes exist to replace.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = rulingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const dispute = await prisma.dispute.findUnique({
    where: { id: params.id },
    include: { scoreEvent: { select: { createdById: true } } },
  });
  if (!dispute) return apiError("That dispute no longer exists", 404);

  const actor = await actorFor(user);
  const pod = await podMemberIds(actor);
  const decision = canResolveDispute(actor, {
    subjectId: dispute.userId,
    inPod: pod.includes(dispute.userId),
    eventAuthorId: dispute.scoreEvent.createdById,
  });

  if (!decision.allowed) return apiError(decision.reason ?? "Not allowed", 403);

  const result = await resolveDispute({
    disputeId: params.id,
    resolverId: user.id,
    uphold: parsed.data.status === "UPHELD",
    responseNote: parsed.data.responseNote,
    asLead: decision.as === "LEAD",
  });

  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json(result);
}
