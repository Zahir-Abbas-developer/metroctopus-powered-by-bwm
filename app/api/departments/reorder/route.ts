import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";

const reorderSchema = z.object({
  /** Department ids in their new display order. */
  ids: z.array(z.string().min(1)).min(1),
});

/**
 * Persist a drag. The whole ordered list is sent rather than one moved id, so
 * the result cannot depend on what the client believed the previous order was.
 */
export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) return apiError("Invalid order", 422);

  const known = await prisma.department.findMany({ select: { id: true } });
  const knownIds = new Set(known.map((d) => d.id));
  if (parsed.data.ids.some((id) => !knownIds.has(id))) {
    return apiError("That list is out of date — refresh and try again", 409);
  }

  await prisma.$transaction(
    parsed.data.ids.map((id, index) =>
      prisma.department.update({ where: { id }, data: { order: index + 1 } }),
    ),
  );

  return NextResponse.json({ ok: true });
}
