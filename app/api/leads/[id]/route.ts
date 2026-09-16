import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  deleteFieldValues,
  fieldsFor,
  validateFieldValues,
  valuesFor,
  writeFieldValues,
} from "@/lib/fields";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { moveLeadStage } from "@/lib/stages";
import { canUseDepartment } from "@/lib/departments";
import { canBeAssigned } from "@/lib/assignment";
import { canEditLeadDetails, canMoveLead } from "@/lib/lead-access";
import { viewerFor } from "@/lib/viewer";
import { canSeeDealValue } from "@/lib/visibility";
import { LEAD_SOURCES, LOST_REASONS } from "@/lib/pipeline-types";
import { hasAdminPower } from "@/lib/constants";

const patchSchema = z.object({
  businessName: z.string().trim().min(2, "Give the business a name").max(120).optional(),
  contactName: z.string().trim().min(2, "Who are we talking to?").max(120).optional(),
  email: z.string().trim().email("That doesn't look like an email").or(z.literal("")).nullish(),
  phone: z.string().trim().max(40).nullish(),
  source: z.enum(LEAD_SOURCES).optional(),
  country: z.string().trim().max(80).nullish(),
  interestedServices: z.array(z.string().min(1)).max(20).optional(),
  estimatedMonthlyValue: z.number().int().min(0).max(1_000_000).optional(),
  dealValue: z.number().int().min(0).max(100_000_000).optional(),
  ownerId: z.string().min(1).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** The department's own questions, keyed by field key. Partial is fine. */
  fieldValues: z.record(z.string(), z.string()).optional(),
  /** Any stage key in this lead's own pipeline; lib/stages.ts validates it. */
  stage: z.string().trim().min(1).optional(),
  lostReason: z.enum(LOST_REASONS).nullish(),
  lostNote: z.string().trim().max(500).nullish(),
});

/** Plain-language names for the timeline entry an edit leaves behind. */
const EDITED_LABEL: Record<string, string> = {
  businessName: "business name",
  contactName: "contact",
  email: "email",
  phone: "phone",
  source: "source",
  country: "country",
  interestedServices: "services",
  estimatedMonthlyValue: "monthly value",
  dealValue: "deal value",
  notes: "notes",
};

/** One lead with its whole activity history — the drawer's payload. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const lead = await prisma.lead.findUnique({
    where: { id: params.id },
    include: {
      owner: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      department: { select: { id: true, shortLabel: true } },
      convertedClient: { select: { id: true, businessName: true } },
      activities: {
        orderBy: { occurredAt: "desc" },
        include: { user: { select: { id: true, name: true, avatarColor: true } } },
      },
    },
  });

  if (!lead) return apiError("That lead no longer exists", 404);

  // A lead in another department answers exactly as a lead that does not exist.
  // Distinguishing them would confirm the record is real to somebody who may
  // not know that, which is a disclosure in itself.
  if (!(await canUseDepartment(user.id, hasAdminPower(user.role), lead.departmentId))) {
    return apiError("That lead no longer exists", 404);
  }

  const [viewer, fields, stage] = await Promise.all([
    viewerFor(user),
    fieldsFor(lead.departmentId, "LEAD"),
    prisma.pipelineStage.findUnique({
      where: { departmentId_key: { departmentId: lead.departmentId, key: lead.stage } },
      select: { label: true, kind: true, colorToken: true },
    }),
  ]);
  const fieldValues = await valuesFor(lead.id, fields);

  /* Money leaves the server only for people allowed to see it, the same rule
     the board applies. This endpoint used to return the whole row to anyone in
     the department, so the drawer carried a deal value the board had just been
     careful to withhold. Deleted rather than nulled, so "withheld" and "zero"
     stay distinguishable. */
  const canSeeMoney = canSeeDealValue(viewer, lead);
  const { estimatedMonthlyValue, dealValue, ...rest } = lead;

  return NextResponse.json({
    lead: {
      ...rest,
      ...(canSeeMoney ? { estimatedMonthlyValue, dealValue } : {}),
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
    /* The stage as this department names it. The drawer used to look the key up
       in the pre-department constants, which only know NEW…WON, so a Pilot Cars
       lead showed an empty badge and a won deal never offered conversion. */
    stageInfo: stage,
    fields,
    fieldValues,
    canEdit: canEditLeadDetails(user, lead),
    canMove: canMoveLead(user, lead),
    canSeeMoney,
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

  // Department first — an id from another business line is not editable just
  // because the caller happens to be its author. A 403 here, as the stage route
  // answers, while reads answer 404: a write with an id already in hand is
  // refused, not pretended away. scripts/permtest.mjs holds this convention.
  if (!(await canUseDepartment(user.id, isAdmin, lead.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  if (!canEditLeadDetails(user, lead)) {
    return apiError("Only the person who added this lead, its owner or an admin can edit it", 403);
  }

  const { stage, lostReason, lostNote, interestedServices, fieldValues, ...rest } = parsed.data;

  // Moving the deal is the owner's, not the author's: stages drive scoring.
  if (stage && stage !== lead.stage && !canMoveLead(user, lead)) {
    return apiError("Only the owner of this deal can move it", 403);
  }

  // Reassigning belongs to the admins. Otherwise a member could hand a deal
  // they are behind on to somebody else.
  if (rest.ownerId !== undefined && rest.ownerId !== lead.ownerId) {
    if (!isAdmin) return apiError("Only an admin can reassign a lead", 403);
    // Someone outside the department could not even see what they were given.
    if (rest.ownerId && !(await canBeAssigned(lead.departmentId, rest.ownerId))) {
      return apiError("Pick an assignee", 422, { ownerId: "That person isn't in this department" });
    }
  }

  // Money is edited by the people allowed to see it, and nobody else.
  if (rest.estimatedMonthlyValue !== undefined || rest.dealValue !== undefined) {
    const viewer = await viewerFor(user);
    if (!canSeeDealValue(viewer, lead)) {
      return apiError("You can't change what this deal is worth", 403);
    }
  }

  /* The department's own answers are validated as a whole — what is already
     stored plus what was sent — because a required question the form did not
     resend is still answered, and a conditional one depends on its siblings. */
  const definitions = fieldValues ? await fieldsFor(lead.departmentId, "LEAD") : [];
  let mergedValues: Record<string, string> | null = null;
  if (fieldValues) {
    const current = await valuesFor(lead.id, definitions);
    mergedValues = { ...current, ...fieldValues };
    const problems = validateFieldValues(definitions, mergedValues);
    if (problems.length > 0) {
      return apiError(
        "Please fix the highlighted fields",
        422,
        Object.fromEntries(problems.map((problem) => [problem.key, problem.message])),
      );
    }
  }

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

  // What actually changed, for the timeline. Comparing against the stored row
  // keeps a save that touched nothing from announcing an edit.
  const changed: string[] = [];
  const differs = (key: keyof typeof lead, next: unknown) => {
    const before = lead[key] ?? null;
    const after = next === "" ? null : (next ?? null);
    return before !== after;
  };
  for (const key of Object.keys(EDITED_LABEL)) {
    if (key === "interestedServices") {
      if (interestedServices !== undefined && interestedServices.join(",") !== lead.interestedServices) {
        changed.push(EDITED_LABEL[key]!);
      }
      continue;
    }
    const value = (rest as Record<string, unknown>)[key];
    if (value !== undefined && differs(key as keyof typeof lead, value)) {
      changed.push(EDITED_LABEL[key]!);
    }
  }

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
      ...(rest.dealValue !== undefined ? { dealValue: rest.dealValue } : {}),
      ...(rest.ownerId !== undefined ? { ownerId: rest.ownerId } : {}),
      ...(rest.notes !== undefined ? { notes: rest.notes || null } : {}),
      ...(interestedServices !== undefined
        ? { interestedServices: interestedServices.join(",") }
        : {}),
    },
  });

  if (fieldValues && mergedValues) {
    const before = await valuesFor(lead.id, definitions);
    const touched = definitions.filter(
      (definition) =>
        fieldValues[definition.key] !== undefined &&
        (before[definition.key] ?? "") !== (fieldValues[definition.key] ?? ""),
    );
    await writeFieldValues(lead.id, definitions, mergedValues);
    changed.push(...touched.map((definition) => definition.label.toLowerCase()));
  }

  if (changed.length > 0) {
    await prisma.salesActivity.create({
      data: {
        departmentId: lead.departmentId,
        leadId: lead.id,
        userId: user.id,
        type: "NOTE",
        isSystem: true,
        note: `Edited ${changed.join(", ")}`,
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
  return NextResponse.json({ lead: updated, changed });
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
