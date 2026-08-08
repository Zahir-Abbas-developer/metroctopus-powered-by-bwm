import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";

const renameSchema = z.object({
  name: z.string().trim().min(2, "Name the workstream").max(80),
});

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const existing = await prisma.module.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That workstream no longer exists", 404);

  try {
    const updated = await prisma.module.update({
      where: { id: params.id },
      data: { name: parsed.data.name },
    });
    return NextResponse.json({ module: updated });
  } catch {
    return apiError("Couldn't rename this workstream", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const existing = await prisma.module.findUnique({
    where: { id: params.id },
    include: { _count: { select: { milestones: true } } },
  });
  if (!existing) return apiError("That workstream no longer exists", 404);

  // Deleting cascades to its milestones, so refuse to do it silently when
  // there is real work inside. The owner clears it out first.
  if (existing._count.milestones > 0) {
    return apiError(
      `Remove its ${existing._count.milestones} milestone${existing._count.milestones === 1 ? "" : "s"} first`,
      409,
    );
  }

  try {
    await prisma.module.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return apiError("Couldn't remove this workstream", 500);
  }
}
