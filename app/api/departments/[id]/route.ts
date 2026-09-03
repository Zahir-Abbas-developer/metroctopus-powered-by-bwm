import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { uniqueSlug } from "@/lib/departments";
import { DEPARTMENT_COLOR_TOKENS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";

const patchSchema = z.object({
  name: z.string().trim().min(2, "Give the department a name").max(120).optional(),
  shortLabel: z.string().trim().min(1, "Give it a short label").max(24).optional(),
  colorToken: z.enum(DEPARTMENT_COLOR_TOKENS).nullish(),
  description: z.string().trim().max(500).nullish(),
  isActive: z.boolean().optional(),
  /**
   * Where the live records go when a department is switched off. Required only
   * when deactivating a department that still owns clients or leads.
   */
  reassignToId: z.string().min(1).nullish(),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { user, response } = await requireAdminApi();
  if (response) return response;

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

  const existing = await prisma.department.findUnique({
    where: { id: params.id },
    include: { _count: { select: { clients: true, leads: true } } },
  });
  if (!existing) return apiError("That department no longer exists", 404);

  const data = parsed.data;
  const live = existing._count.clients + existing._count.leads;

  // Deactivating is only safe when nothing live points at the department.
  // Otherwise the admin makes an explicit choice — move the records somewhere,
  // or leave the department on. Silently hiding rows that still exist is how a
  // department-scoped query starts returning nothing with no explanation.
  if (data.isActive === false && existing.isActive && live > 0) {
    if (!data.reassignToId) {
      return apiError(
        `${existing.name} still has ${existing._count.clients} client(s) and ${existing._count.leads} deal(s). Choose where they should move before switching it off.`,
        409,
        { reassignToId: "Pick a department to move the records to" },
      );
    }

    const target = await prisma.department.findFirst({
      where: { id: data.reassignToId, isActive: true, NOT: { id: existing.id } },
      select: { id: true, name: true },
    });
    if (!target) {
      return apiError("Pick a department to move the records to", 422, {
        reassignToId: "That department is not available",
      });
    }

    await prisma.$transaction([
      prisma.client.updateMany({
        where: { departmentId: existing.id },
        data: { departmentId: target.id },
      }),
      prisma.lead.updateMany({
        where: { departmentId: existing.id },
        data: { departmentId: target.id },
      }),
    ]);

    await recordAudit({
      actorId: user!.id,
      action: "DEPARTMENT_UPDATED",
      entityType: "Department",
      entityId: existing.id,
      summary: `Moved ${live} record(s) from ${existing.name} to ${target.name}`,
    });
  }

  const department = await prisma.department.update({
    where: { id: existing.id },
    data: {
      ...(data.name ? { name: data.name, slug: await uniqueSlug(data.name, existing.id) } : {}),
      ...(data.shortLabel ? { shortLabel: data.shortLabel } : {}),
      ...(data.colorToken !== undefined ? { colorToken: data.colorToken ?? null } : {}),
      ...(data.description !== undefined ? { description: data.description || null } : {}),
      ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
    },
  });

  await recordAudit({
    actorId: user!.id,
    action: "DEPARTMENT_UPDATED",
    entityType: "Department",
    entityId: department.id,
    summary: `Updated department ${department.name}`,
  });

  return NextResponse.json({ department });
}
