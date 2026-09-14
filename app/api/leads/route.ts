import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { viewerFor } from "@/lib/viewer";
import { departmentScope } from "@/lib/visibility";
import { serializeLead, serializePipelineMetrics } from "@/lib/serializers";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { pipelineMetrics } from "@/lib/pipeline";
import { LEAD_SOURCES } from "@/lib/pipeline-types";
import { hasAdminPower } from "@/lib/constants";
import { canUseDepartment } from "@/lib/departments";
import { canBeAssigned } from "@/lib/assignment";
import { autoAssign, leadSignals } from "@/lib/auto-assign";
import { notify } from "@/lib/notifications";
import { fieldsFor, validateFieldValues, writeFieldValues } from "@/lib/fields";

const leadSchema = z.object({
  // The business line this deal belongs to. Also decides which pipeline
  // stages are valid for it.
  departmentId: z.string().min(1, "Pick a department"),
  businessName: z.string().trim().min(2, "Give the business a name").max(120),
  contactName: z.string().trim().min(2, "Who are we talking to?").max(120),
  email: z.string().trim().email("That doesn't look like an email").or(z.literal("")).nullish(),
  phone: z.string().trim().max(40).nullish(),
  source: z.enum(LEAD_SOURCES).default("OUTREACH"),
  country: z.string().trim().max(80).nullish(),
  /** ServiceCatalog slugs. */
  interestedServices: z.array(z.string().min(1)).max(20).default([]),
  estimatedMonthlyValue: z.number().int().min(0).max(1_000_000).default(0),
  /** What the deal is worth: a quote, a premium, an expected volume. */
  dealValue: z.number().int().min(0).max(100_000_000).default(0),
  ownerId: z.string().min(1).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  /** Opening stage, from this department's pipeline. */
  stage: z.string().trim().min(1).max(60).optional(),
  /** Department-specific answers, keyed by field key. */
  fieldValues: z.record(z.string(), z.string()).default({}),
});

/**
 * The pipeline board.
 *
 * Everyone can see the pipeline — a five-person agency where only the owner
 * knows what's coming is a five-person agency that gets surprised. Members can
 * only *edit* leads they own; that check lives on the write paths.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  /* Deal values are agency money. Before this, every signed-in person received
     the whole pipeline — per-stage totals, open value, average deal size and a
     figure against every lead — regardless of whether they had anything to do
     with sales. The component showed less than the response carried, which is
     not the same as the response carrying less. */
  const viewer = await viewerFor(user);

  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get("ownerId");
  const includeClosed = searchParams.get("closed") === "1";

  const [leads, metrics, owners, services] = await Promise.all([
    prisma.lead.findMany({
      where: {
        // Doctrine 2. Before this, every signed-in person received every
        // department's pipeline from this endpoint — the component showed less
        // than the response carried, which is not the same as the response
        // carrying less.
        ...departmentScope(viewer),
        ...(ownerId && ownerId !== "ALL" ? { ownerId } : {}),
        ...(includeClosed ? {} : { stage: { notIn: ["WON", "LOST"] } }),
      },
      orderBy: [{ stageChangedAt: "desc" }],
      include: {
        owner: { select: { id: true, name: true, avatarColor: true } },
        _count: { select: { activities: true } },
      },
    }),
    pipelineMetrics(),
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, avatarColor: true },
    }),
    prisma.serviceCatalog.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { slug: true, name: true },
    }),
  ]);

  return NextResponse.json({
    metrics: serializePipelineMetrics(metrics, viewer),
    owners,
    services,
    viewer: {
      id: user.id,
      isAdmin: hasAdminPower(user.role),
      canSeeDealValues: viewer.role === "ADMIN" || viewer.isBusinessDev,
    },
    leads: leads.map((lead) => serializeLead({
      id: lead.id,
      ownerId: lead.ownerId,
      businessName: lead.businessName,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      country: lead.country,
      interestedServices: splitSlugs(lead.interestedServices),
      estimatedMonthlyValue: lead.estimatedMonthlyValue,
      dealValue: lead.dealValue,
      stage: lead.stage,
      stageChangedAt: lead.stageChangedAt,
      lostReason: lead.lostReason,
      lostNote: lead.lostNote,
      owner: lead.owner,
      activityCount: lead._count.activities,
      convertedClientId: lead.convertedClientId,
      createdAt: lead.createdAt,
    }, viewer)),
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

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const data = parsed.data;

  // A departmentId that does not resolve would otherwise surface as a foreign
  // key error and a 500. Checked here so the caller gets a field-level 422.
  const department = await prisma.department.findFirst({
    where: { id: data.departmentId, isActive: true },
    select: { id: true },
  });
  if (!department) {
    return apiError("Pick a department", 422, { departmentId: "That department no longer exists" });
  }

  // Membership is checked on the write, not only on the picker. A member who
  // crafts a payload naming someone else's department would otherwise file a
  // record they cannot then see.
  if (!(await canUseDepartment(user.id, hasAdminPower(user.role), department.id))) {
    return apiError("Pick a department", 403, {
      departmentId: "That department isn't one of yours",
    });
  }

  // The opening stage belongs to the department, not to a constant. Affiliates
  // opens at "Applied", Pilot Cars at "New enquiry" — a hardcoded "NEW" files
  // an Affiliates lead into a stage that department does not have, where no
  // column on its board will ever show it.
  const stages = await prisma.pipelineStage.findMany({
    where: { departmentId: department.id, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    select: { key: true, kind: true },
  });
  if (stages.length === 0) {
    return apiError("That department has no pipeline stages yet", 422, {
      stage: "An admin needs to add stages before leads can be filed here",
    });
  }

  const opening = stages.find((stage) => stage.kind === "OPEN") ?? stages[0];
  const stage = data.stage ?? opening.key;
  if (!stages.some((row) => row.key === stage)) {
    return apiError("Pick a stage", 422, { stage: "That stage isn't in this pipeline" });
  }

  // An assignee outside the department cannot see the record they were given.
  if (data.ownerId && !(await canBeAssigned(department.id, data.ownerId))) {
    return apiError("Pick an assignee", 422, {
      ownerId: "That person isn't in this department",
    });
  }

  const definitions = await fieldsFor(department.id, "LEAD");
  const fieldProblems = validateFieldValues(definitions, data.fieldValues);
  if (fieldProblems.length > 0) {
    return apiError(
      "Please fix the highlighted fields",
      422,
      Object.fromEntries(fieldProblems.map((problem) => [problem.key, problem.message])),
    );
  }

  /* Who does this deal actually belong to.

     An explicit choice always wins — the person filling in the form knows why
     this one is different. With no choice made, the router reads what the deal
     is about and sends it to whoever does that work, because the previous
     default (whoever typed it in) reliably parked every enquiry on the person
     who answered the phone. If the router cannot decide, that old default is
     still the floor: an unowned lead is invisible work. */
  const routed = data.ownerId
    ? null
    : await autoAssign(
        department.id,
        leadSignals({
          interestedServices: data.interestedServices,
          fieldValues: data.fieldValues,
          notes: data.notes,
        }),
      );

  const ownerId = data.ownerId ?? routed?.userId ?? user.id;

  const lead = await prisma.lead.create({
    data: {
      departmentId: department.id,
      businessName: data.businessName,
      contactName: data.contactName,
      email: data.email || null,
      phone: data.phone || null,
      source: data.source,
      country: data.country || null,
      interestedServices: data.interestedServices.join(","),
      estimatedMonthlyValue: data.estimatedMonthlyValue,
      dealValue: data.dealValue,
      ownerId,
      notes: data.notes || null,
      stage,
    },
  });

  await writeFieldValues(lead.id, definitions, data.fieldValues);

  /* A routing decision nobody can see is a routing decision nobody trusts, so
     the reason goes on the lead timeline as a system entry and the person who
     now owns the deal is told. Neither is allowed to fail the creation. */
  if (routed?.userId) {
    await recordRouting(lead.id, department.id, routed.userId, routed.reason);
  }
  if (ownerId !== user.id) {
    await notify({
      userId: ownerId,
      type: "TASK_ASSIGNED",
      title: "A lead was assigned to you",
      body: routed?.reason
        ? `${data.businessName} — ${routed.reason}.`
        : `${data.businessName} was assigned to you.`,
      href: `/pipeline?lead=${lead.id}`,
    });
  }

  /* A lean shape rather than the raw row: the caller needs to know *where* the
     lead landed so it can show the board it landed on. Returning the record
     wholesale would also hand the deal value back to a creator the visibility
     matrix would not otherwise show it to. */
  return NextResponse.json(
    {
      lead: {
        id: lead.id,
        departmentId: lead.departmentId,
        stage: lead.stage,
        ownerId: lead.ownerId,
      },
      assignment: routed && routed.userId
        ? { userId: routed.userId, name: routed.name, strategy: routed.strategy, reason: routed.reason }
        : null,
    },
    { status: 201 },
  );
}

/** The "why it went there" line on the lead timeline. Never throws. */
async function recordRouting(
  leadId: string,
  departmentId: string,
  userId: string,
  reason: string,
): Promise<void> {
  try {
    await prisma.salesActivity.create({
      data: {
        departmentId,
        leadId,
        userId,
        type: "ASSIGNMENT",
        note: `Routed automatically. ${reason}.`,
        isSystem: true,
      },
    });
  } catch (error) {
    console.error("routing activity failed", error);
  }
}

/** Comma-separated slugs, as stored. Local — a route may only export handlers. */
function splitSlugs(value: string): string[] {
  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}
