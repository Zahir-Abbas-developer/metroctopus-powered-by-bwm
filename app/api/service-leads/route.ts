import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { allServiceLeads } from "@/lib/permissions-service";
import { recordAudit } from "@/lib/audit";

const saveSchema = z.object({
  userId: z.string().min(1),
  /** The complete set for this person — anything absent is removed. */
  serviceIds: z.array(z.string().min(1)).max(20),
});

/** Who leads what. Readable by anyone so members know who approves their work. */
export async function GET() {
  const leads = await allServiceLeads();
  const services = await prisma.serviceCatalog.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
    select: { id: true, name: true, slug: true },
  });
  const members = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, jobTitle: true, avatarColor: true, role: true },
  });

  return NextResponse.json({ leads, services, members });
}

export async function PUT(request: Request) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const member = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true, name: true, isActive: true },
  });
  if (!member) return apiError("That member no longer exists", 404);
  if (!member.isActive) {
    return apiError("A deactivated member can't lead a service line", 422);
  }

  const before = (
    await prisma.serviceLead.findMany({
      where: { userId: member.id },
      select: { serviceId: true },
    })
  ).map((row) => row.serviceId);

  // Replace wholesale: the form submits the complete set, and diffing here
  // would let a stale client silently keep a lead they thought they'd removed.
  await prisma.serviceLead.deleteMany({ where: { userId: member.id } });
  if (parsed.data.serviceIds.length > 0) {
    await prisma.serviceLead.createMany({
      data: parsed.data.serviceIds.map((serviceId) => ({ userId: member.id, serviceId })),
    });
  }

  const names = await prisma.serviceCatalog.findMany({
    where: { id: { in: parsed.data.serviceIds } },
    select: { name: true },
  });

  await recordAudit({
    actorId: admin!.id,
    action: "LEAD_ASSIGNED",
    entityType: "User",
    entityId: member.id,
    summary:
      parsed.data.serviceIds.length === 0
        ? `${member.name} no longer leads any service line`
        : `${member.name} leads ${names.map((service) => service.name).join(", ")}`,
    before: { serviceIds: before },
    after: { serviceIds: parsed.data.serviceIds },
  });

  return NextResponse.json({ leads: await allServiceLeads() });
}
