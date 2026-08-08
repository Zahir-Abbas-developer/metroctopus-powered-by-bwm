import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { createModuleSchema, fieldErrors } from "@/lib/validation";

/**
 * Add a workstream to an existing plan.
 *
 * Needed because a service the owner adds to the catalogue themselves has no
 * built-in template — without this its projects would arrive with nowhere to
 * put the work.
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

  const parsed = createModuleSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const project = await prisma.project.findUnique({
    where: { id: parsed.data.projectId },
  });
  if (!project) return apiError("That engagement no longer exists", 404);

  const last = await prisma.module.findFirst({
    where: { projectId: project.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  try {
    const created = await prisma.module.create({
      data: {
        projectId: project.id,
        name: parsed.data.name,
        serviceId: parsed.data.serviceId ?? null,
        order: (last?.order ?? -1) + 1,
      },
    });
    return NextResponse.json({ module: created }, { status: 201 });
  } catch {
    return apiError("Couldn't add this workstream", 500);
  }
}
