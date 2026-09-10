import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { deleteFieldValues } from "@/lib/fields";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { moveLeadStage } from "@/lib/stages";
import { LEAD_SOURCES, LEAD_STAGES, LOST_REASONS } from "@/lib/pipeline-types";
import { hasAdminPower } from "@/lib/constants";

const patchSchema = z.object({
  businessName: z.string().trim().min(2).max(120).optional(),
  contactName: z.string().trim().min(2).max(120).optional(),
  email: z.string().trim().email().or(z.literal("")).nullish(),
  phone: z.string().trim().max(40).nullish(),
  source: z.enum(LEAD_SOURCES).optional(),
  country: z.string().trim().max(80).nullish(),
  interestedServices: z.array(z.string().min(1)).max(20).optional(),
  estimatedMonthlyValue: z.number().int().min(0).max(1_000_000).optional(),
  ownerId: z.string().min(1).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Any stage key in this lead's own pipeline; lib/stages.ts validates it. */
  stage: z.string().trim().min(1).optional(),
  lostReason: z.enum(LOST_REASONS).nullish(),
  lostNote: z.string().trim().max(500).nullish(),
});

/** One lead with its whole activity history — the drawer's payload. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      owner: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      convertedClient: { select: { id: true, businessName: true } },
      activities: {
        orderBy: { occurredAt: "desc" },
        include: { user: { select: { id: true, name: true, avatarColor: true } } },
      },
    },
  });

  if (!lead) return apiError("That lead no longer exists", 404);

  return NextResponse.json({
    lead: {
      ...lead,
      interestedServices: lead.interestedServices.split(",").filter(Boolean),
      stageChangedAt: lead.stageChangedAt.toISOString(),
      createdAt: lead.createdAt.toISOString(),
      convertedAt: lead.convertedAt?.toISOString() ?? null,
      activities: lead.activities.map((activity) => ({
        id: activity.id,
        type: activity.type,
        note: activity.note,
        occurredAt: activity.occurredAt.toISOString(),
        user: activity.user,
      })),
    },
    canEdit: hasAdminPower(user.role) || lead.ownerId === user.id,
    // The timeline needs to know who is looking to decide whose entries
    // carry a delete control.
    viewer: { id: user.id, isAdmin: hasAdminPower(user.role) },
  });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const lead = await prisma.lead.findUnique({ where: { id: params.id } });
  if (!lead) return apiError("That lead no longer exists", 404);

  const isAdmin = hasAdminPower(user.role);
  if (!isAdmin && lead.ownerId !== user.id) {
    return apiError("You can only edit leads you own", 403);
  }

  // Reassigning belongs to the owner. Otherwise a member could hand a deal
  // they are behind on to somebody else.
  if (parsed.data.ownerId !== undefined && !isAdmin) {
    return apiError("Only the agency owner can reassign a lead", 403);
  }

  const { stage, lostReason, lostNote, interestedServices, ...rest } = parsed.data;

  // The stage move goes through lib/stages.ts — the same function the board's
  // drag calls. It used to call a second implementation that compared
  // `stage === "WON"`, a literal only Culture Plus has: a Pilot Cars deal
  // edited to Completed from this drawer skipped the payout, the notification
  // and the timeline entry that the same move made on the board produced.
  if (stage && stage !== lead.stage) {
    const result = await moveLeadStage({
      leadId: lead.id,
      toStageKey: stage,
      actorId: user.id,
      lostReason: lostReason ?? null,
      lostNote: lostNote ?? null,
    });

    if (!result.ok) {
      return apiError(
        result.error,
        result.status,
        result.field ? { [result.field]: result.error } : undefined,
      );
    }
  }

  const hasFieldEdits =
    Object.keys(rest).length > 0 || interestedServices !== undefined;

  if (hasFieldEdits) {
    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...(rest.businessName !== undefined ? { businessName: rest.businessName } : {}),
        ...(rest.contactName !== undefined ? { contactName: rest.contactName } : {}),
        ...(rest.email !== undefined ? { email: rest.email || null } : {}),
        ...(rest.phone !== undefined ? { phone: rest.phone || null } : {}),
        ...(rest.source !== undefined ? { source: rest.source } : {}),
        ...(rest.country !== undefined ? { country: rest.country || null } : {}),
        ...(rest.estimatedMonthlyValue !== undefined
          ? { estimatedMonthlyValue: rest.estimatedMonthlyValue }
          : {}),
        ...(rest.ownerId !== undefined ? { ownerId: rest.ownerId } : {}),
        ...(rest.notes !== undefined ? { notes: rest.notes || null } : {}),
        ...(interestedServices !== undefined
          ? { interestedServices: interestedServices.join(",") }
          : {}),
      },
    });
  }

  // Reassignment is a system event worth remembering: "why is this mine?" is a
  // question the timeline should be able to answer without an audit export.
  if (rest.ownerId !== undefined && rest.ownerId !== lead.ownerId) {
    const [from, to] = await Promise.all([
      lead.ownerId
        ? prisma.user.findUnique({ where: { id: lead.ownerId }, select: { name: true } })
        : null,
      rest.ownerId
        ? prisma.user.findUnique({ where: { id: rest.ownerId }, select: { name: true } })
        : null,
    ]);

    await prisma.salesActivity.create({
      data: {
        departmentId: lead.departmentId,
        leadId: lead.id,
        userId: user.id,
        type: "ASSIGNMENT",
        isSystem: true,
        note: `${from?.name ?? "Unassigned"} → ${to?.name ?? "Unassigned"}`,
      },
    });
  }

  const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
  return NextResponse.json({ lead: updated });
}

/**
 * Deleting a lead is the owner's call.
 *
 * Allowed, unlike deactivating a member, because a duplicate or a mistyped
 * prospect is genuinely worth removing — but not once it has been won, since
 * a won lead is the provenance of a client.
 */
export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);
  if (!hasAdminPower(user.role)) return apiError("Only the agency owner can delete a lead", 403);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    select: { convertedClientId: true },
  });
  if (!lead) return apiError("That lead no longer exists", 404);

  if (lead.convertedClientId) {
    return apiError("This lead became a client — it's the record of where they came from", 409);
  }

  // Answers are not reached by the cascade — FieldValue.recordId is not a
  // foreign key, because the definition's `entity` decides which table it
  // points at. See deleteFieldValues in lib/fields.ts.
  await deleteFieldValues(params.id);

  await prisma.lead.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
