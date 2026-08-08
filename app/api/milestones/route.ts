import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { createMilestoneSchema, fieldErrors } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";

export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = createMilestoneSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const dueDate = parseDateInput(parsed.data.dueDate);
  if (!dueDate) return apiError("Enter a valid due date", 422, { dueDate: "Use a valid date" });

  // Not named `module`: Next forbids assigning that identifier, since it
  // shadows the CommonJS global.
  const workstream = await prisma.module.findUnique({
    where: { id: parsed.data.moduleId },
  });
  if (!workstream) return apiError("That workstream no longer exists", 404);

  if (parsed.data.assigneeId) {
    const assignee = await prisma.user.findFirst({
      where: { id: parsed.data.assigneeId, isActive: true },
    });
    if (!assignee) {
      return apiError("That team member isn't available", 422, {
        assigneeId: "Pick an active team member",
      });
    }
  }

  const last = await prisma.milestone.findFirst({
    where: { moduleId: workstream.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  try {
    const milestone = await prisma.milestone.create({
      data: {
        moduleId: workstream.id,
        title: parsed.data.title,
        description: parsed.data.description,
        weight: parsed.data.weight,
        dueDate,
        assigneeId: parsed.data.assigneeId ?? null,
        order: (last?.order ?? -1) + 1,
      },
    });
    return NextResponse.json({ milestone }, { status: 201 });
  } catch {
    return apiError("Couldn't add this milestone", 500);
  }
}
