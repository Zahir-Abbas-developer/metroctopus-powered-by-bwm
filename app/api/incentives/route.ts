import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { incentiveQueue } from "@/lib/incentives-service";
import { recordAudit } from "@/lib/audit";

const actionSchema = z.object({
  id: z.string().min(1),
  bonusAmount: z.number().min(0).max(10_000_000).nullish(),
  bonusPercent: z.number().min(0).max(100).nullish(),
  note: z.string().trim().max(1000).nullish(),
  /** Marks it dealt with, so the list stays a queue rather than an archive. */
  actioned: z.boolean().optional(),
});

/** The owner's bonus-eligible list and performance-review flags. */
export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  return NextResponse.json({ awards: await incentiveQueue() });
}

/**
 * Recording what the owner decided.
 *
 * The amount is a **payroll reference** — this app never moves money, and
 * pretending otherwise would be a much bigger feature wearing a small one's
 * clothes.
 */
export async function PATCH(request: Request) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const award = await prisma.incentiveAward.findUnique({
    where: { id: parsed.data.id },
    include: { user: { select: { name: true } } },
  });
  if (!award) return apiError("That award no longer exists", 404);

  const updated = await prisma.incentiveAward.update({
    where: { id: award.id },
    data: {
      ...(parsed.data.bonusAmount !== undefined ? { bonusAmount: parsed.data.bonusAmount } : {}),
      ...(parsed.data.bonusPercent !== undefined ? { bonusPercent: parsed.data.bonusPercent } : {}),
      ...(parsed.data.note !== undefined ? { actionedNote: parsed.data.note } : {}),
      ...(parsed.data.actioned ? { actionedAt: new Date() } : {}),
    },
  });

  await recordAudit({
    actorId: admin!.id,
    action: "INCENTIVE_ACTIONED",
    entityType: "IncentiveAward",
    entityId: award.id,
    summary: `${award.type === "EXCELLENCE_STREAK" ? "Bonus" : "Review"} for ${award.user.name} — ${
      parsed.data.actioned ? "actioned" : "updated"
    }`,
    before: { bonusAmount: award.bonusAmount, bonusPercent: award.bonusPercent },
    after: { bonusAmount: updated.bonusAmount, bonusPercent: updated.bonusPercent },
  });

  return NextResponse.json({ award: updated });
}
