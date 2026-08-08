import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { canDecideAttendance } from "@/lib/permissions";
import { actorFor, podMemberIds } from "@/lib/permissions-service";
import { recordAudit } from "@/lib/audit";
import { fieldErrors } from "@/lib/validation";
import { reviewOutage } from "@/lib/outages";

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  adminNote: z.string().trim().max(500).nullish(),
});

/** The owner's decision on an outage report. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  // Rejecting reinstates a penalty, so it needs a reason on the record — the
  // same standard the excuse and veto paths hold to.
  if (parsed.data.status === "REJECTED" && (parsed.data.adminNote?.trim().length ?? 0) < 5) {
    return apiError("Say why the outage isn't upheld — the member is charged for it", 422, {
      adminNote: "A written reason is required",
    });
  }

  const report = await prisma.outageReport.findUnique({
    where: { id: params.id },
    select: { userId: true, user: { select: { name: true } } },
  });
  if (!report) return apiError("That report no longer exists", 404);

  const actor = await actorFor(user);
  const pod = await podMemberIds(actor);
  const decision = canDecideAttendance(actor, {
    userId: report.userId,
    inPod: pod.includes(report.userId),
  });
  if (!decision.allowed) return apiError(decision.reason ?? "Not allowed", 403);

  const result = await reviewOutage({
    reportId: params.id,
    adminId: user.id,
    approve: parsed.data.status === "APPROVED",
    adminNote: parsed.data.adminNote ?? null,
  });

  if (!result.ok) return apiError(result.reason, 409);

  await recordAudit({
    actorId: user.id,
    action: "OUTAGE_REVIEWED",
    entityType: "OutageReport",
    entityId: params.id,
    summary: `${parsed.data.status === "APPROVED" ? "Upheld" : "Rejected"} ${report.user.name}'s outage report`,
    after: { status: parsed.data.status, excused: result.excused, charged: result.charged },
    asLead: decision.as === "LEAD",
  });

  return NextResponse.json(result);
}
