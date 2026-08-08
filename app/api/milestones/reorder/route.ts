import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, reorderMilestonesSchema } from "@/lib/validation";

export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = reorderMilestonesSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const { moduleId, ids } = parsed.data;

  const existing = await prisma.milestone.findMany({
    where: { moduleId },
    select: { id: true },
  });

  // Reject a partial list rather than silently leaving rows behind at their old
  // positions, which would produce duplicate order values.
  const known = new Set(existing.map((milestone) => milestone.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    return apiError("That ordering doesn't match this workstream", 409);
  }

  try {
    await prisma.$transaction(
      ids.map((id, index) =>
        prisma.milestone.update({ where: { id }, data: { order: index } }),
      ),
    );
    return NextResponse.json({ ok: true });
  } catch {
    return apiError("Couldn't save the new order", 500);
  }
}
