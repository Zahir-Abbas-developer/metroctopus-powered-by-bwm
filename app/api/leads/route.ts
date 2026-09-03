import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { viewerFor } from "@/lib/viewer";
import { serializeLead, serializePipelineMetrics } from "@/lib/serializers";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { pipelineMetrics } from "@/lib/pipeline";
import { LEAD_SOURCES } from "@/lib/pipeline-types";
import { hasAdminPower } from "@/lib/constants";

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
  ownerId: z.string().min(1).nullish(),
  notes: z.string().trim().max(2000).nullish(),
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
      // Unowned leads are invisible work. Whoever adds one owns it unless the
      // owner says otherwise.
      ownerId: data.ownerId ?? user.id,
      notes: data.notes || null,
      stage: "NEW",
    },
  });

  return NextResponse.json({ lead }, { status: 201 });
}

/** Comma-separated slugs, as stored. Local — a route may only export handlers. */
function splitSlugs(value: string): string[] {
  return value
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}
