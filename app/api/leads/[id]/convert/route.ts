import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { WINNING_STAGE_KINDS, type StageKind } from "@/lib/constants";

/**
 * Everything the onboarding wizard needs to open pre-filled from a won deal.
 *
 * Deliberately a read, not a write. The wizard is where the owner sets the
 * budget, the cycle dates and the services that will generate a month of
 * work — converting silently in the background would create a client and a
 * plan nobody looked at. This hands the wizard a draft; the existing
 * POST /api/clients still does the creating.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: { convertedClient: { select: { id: true, businessName: true } } },
  });

  if (!lead) return apiError("That lead no longer exists", 404);
  if (lead.convertedClient) {
    return apiError(
      `${lead.businessName} is already a client`,
      409,
      undefined,
    );
  }
  /* Won means a stage whose *kind* is a winning one, not a stage keyed "WON".

     Stages are per-department records with their own keys: Pilot Cars wins at
     COMPLETED, and other lines name theirs differently again. Comparing the
     key to "WON" refused every one of them, so a closed deal in any real
     department could never become a client. The literal key still counts,
     for leads filed before departments had pipelines of their own. */
  const stage = await prisma.pipelineStage.findUnique({
    where: { departmentId_key: { departmentId: lead.departmentId, key: lead.stage } },
    select: { kind: true },
  });
  const won =
    lead.stage === "WON" ||
    (stage !== null && WINNING_STAGE_KINDS.includes(stage.kind as StageKind));
  if (!won) {
    return apiError("Mark the deal won before converting it", 409);
  }

  const slugs = lead.interestedServices.split(",").map((slug) => slug.trim()).filter(Boolean);

  const services = await prisma.serviceCatalog.findMany({
    where: { slug: { in: slugs }, isActive: true },
    select: { id: true, slug: true, name: true },
  });

  // A service could have been retired between the lead being logged and the
  // deal closing. Say so rather than silently dropping it from the plan.
  const missing = slugs.filter((slug) => !services.some((service) => service.slug === slug));

  return NextResponse.json({
    draft: {
      leadId: lead.id,
      // The client belongs to the business line that won the deal.
      departmentId: lead.departmentId,
      businessName: lead.businessName,
      contactName: lead.contactName,
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      country: lead.country ?? "",
      monthlyBudget: lead.estimatedMonthlyValue,
      serviceIds: services.map((service) => service.id),
      notes: lead.notes ?? "",
    },
    unavailableServices: missing,
  });
}

/**
 * Links a lead to the client it became.
 *
 * Called by the wizard once the client exists. Kept separate from creation so
 * a failed conversion leaves neither a half-made client nor a lead that
 * believes it converted.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let clientId: string | null = null;
  try {
    clientId = ((await request.json()) as { clientId?: string })?.clientId ?? null;
  } catch {
    // Handled below.
  }
  if (!clientId) return apiError("Which client?", 422, { clientId: "Required" });

  const [lead, client] = await Promise.all([
    prisma.lead.findUnique({ where: { id: params.id } }),
    prisma.client.findUnique({ where: { id: clientId }, select: { id: true } }),
  ]);

  if (!lead) return apiError("That lead no longer exists", 404);
  if (!client) return apiError("That client no longer exists", 404);
  if (lead.convertedClientId) return apiError("That lead has already been converted", 409);

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      convertedClientId: client.id,
      convertedAt: new Date(),
      // Converting implies the deal is won, even if it was dragged straight
      // from NEGOTIATION into the wizard.
      ...(lead.stage === "WON" ? {} : { stage: "WON", stageChangedAt: new Date() }),
    },
  });

  return NextResponse.json({ ok: true });
}
