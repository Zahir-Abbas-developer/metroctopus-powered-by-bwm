import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, updateClientSchema } from "@/lib/validation";

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

  const parsed = updateClientSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const existing = await prisma.client.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That client no longer exists", 404);

  try {
    const client = await prisma.client.update({
      where: { id: params.id },
      data: parsed.data,
    });
    return NextResponse.json({ client });
  } catch {
    return apiError("Couldn't save those changes", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const existing = await prisma.client.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That client no longer exists", 404);

  try {
    // Cascades through projects, modules and milestones. Score events survive
    // with a null milestone, so a member's history is never rewritten by an
    // account being removed.
    await prisma.client.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return apiError("Couldn't remove this client", 500);
  }
}
