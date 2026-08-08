import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, updateMilestoneSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { clientNameForModule, notifyAssigned } from "@/lib/notifications";
import { recordDueDateChange, recordReassignment } from "@/lib/activity";

/** Field edits are the owner's alone. Status changes live in ./status. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = updateMilestoneSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const existing = await prisma.milestone.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That milestone no longer exists", 404);

  const { dueDate, assigneeId, ...rest } = parsed.data;

  let parsedDue: Date | undefined;
  if (dueDate) {
    const value = parseDateInput(dueDate);
    if (!value) return apiError("Enter a valid due date", 422, { dueDate: "Use a valid date" });
    parsedDue = value;
  }

  if (assigneeId) {
    const assignee = await prisma.user.findFirst({ where: { id: assigneeId, isActive: true } });
    if (!assignee) {
      return apiError("That team member isn't available", 422, {
        assigneeId: "Pick an active team member",
      });
    }
  }

  try {
    const milestone = await prisma.milestone.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(parsedDue ? { dueDate: parsedDue } : {}),
        ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? null } : {}),
      },
      include: { assignee: { select: { id: true, name: true, avatarColor: true } } },
    });
    if (assigneeId !== undefined && (assigneeId ?? null) !== existing.assigneeId) {
      const previous = existing.assigneeId
        ? await prisma.user.findUnique({
            where: { id: existing.assigneeId },
            select: { name: true },
          })
        : null;

      await recordReassignment({
        milestoneId: milestone.id,
        title: milestone.title,
        fromName: previous?.name ?? null,
        toName: milestone.assignee?.name ?? null,
        actorId: admin!.id,
      });
    }

    if (parsedDue && parsedDue.getTime() !== existing.dueDate.getTime()) {
      await recordDueDateChange({
        milestoneId: milestone.id,
        title: milestone.title,
        from: existing.dueDate,
        to: parsedDue,
        actorId: admin!.id,
      });
    }

    // Only on a genuine handover — re-saving the same assignee shouldn't ping
    // them again.
    if (assigneeId && assigneeId !== existing.assigneeId) {
      await notifyAssigned({
        id: milestone.id,
        title: milestone.title,
        dueDate: milestone.dueDate,
        assigneeId,
        clientName: await clientNameForModule(milestone.moduleId),
      });
    }

    return NextResponse.json({ milestone });
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

  const existing = await prisma.milestone.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That milestone no longer exists", 404);

  try {
    // Score events keep their history with a null milestone reference — a
    // member's ledger is never rewritten by a plan being tidied up.
    await prisma.milestone.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return apiError("Couldn't remove this milestone", 500);
  }
}
