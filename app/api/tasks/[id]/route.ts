import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { canUseDepartment } from "@/lib/departments";
import { canBeAssigned } from "@/lib/assignment";
import { parseDateInput } from "@/lib/date";
import { hasAdminPower, TASK_PRIORITIES, TASK_STATUSES } from "@/lib/constants";

const patchSchema = z.object({
  title: z.string().trim().min(2).max(160).optional(),
  note: z.string().trim().max(2000).nullish(),
  assigneeId: z.string().min(1).nullish(),
  dueAt: z.string().trim().nullish(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  status: z.enum(TASK_STATUSES).optional(),
});

/**
 * Edit or complete a task.
 *
 * Completion is the common case and is a status change like any other, so it
 * shares this route rather than getting an endpoint of its own — a checkbox and
 * an edit form must not be able to disagree about what "done" means.
 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

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

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, departmentId: true, assigneeId: true, createdById: true, status: true },
  });
  if (!task) return apiError("That task no longer exists", 404);

  const isAdmin = hasAdminPower(user.role);

  if (!(await canUseDepartment(user.id, isAdmin, task.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  // Being in the department lets you see the task; doing something about it
  // belongs to the person carrying it or the person who wrote it.
  const mine = task.assigneeId === user.id || task.createdById === user.id;
  if (!isAdmin && !mine) {
    return apiError("That's someone else's task", 403);
  }

  const data = parsed.data;

  if (data.assigneeId && !(await canBeAssigned(task.departmentId, data.assigneeId))) {
    return apiError("Please fix the highlighted fields", 422, {
      assigneeId: "That person isn't in this department",
    });
  }

  let dueAt: Date | null | undefined;
  if (data.dueAt !== undefined) {
    dueAt = data.dueAt ? parseDateInput(data.dueAt) : null;
    if (data.dueAt && !dueAt) {
      return apiError("Please fix the highlighted fields", 422, {
        dueAt: "That isn't a date we can read",
      });
    }
  }

  const updated = await prisma.task.update({
    where: { id: task.id },
    data: {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.note !== undefined ? { note: data.note || null } : {}),
      ...(data.assigneeId !== undefined ? { assigneeId: data.assigneeId ?? null } : {}),
      ...(dueAt !== undefined ? { dueAt } : {}),
      ...(data.priority !== undefined ? { priority: data.priority } : {}),
      ...(data.status !== undefined
        ? {
            status: data.status,
            // Stamped when it is done and cleared when it is reopened, so the
            // timestamp can never describe a task that is currently open.
            completedAt: data.status === "DONE" ? new Date() : null,
          }
        : {}),
    },
  });

  return NextResponse.json({ task: updated });
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const task = await prisma.task.findUnique({
    where: { id: params.id },
    select: { id: true, departmentId: true, assigneeId: true, createdById: true },
  });
  if (!task) return apiError("That task no longer exists", 404);

  const isAdmin = hasAdminPower(user.role);
  if (!(await canUseDepartment(user.id, isAdmin, task.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }
  if (!isAdmin && task.assigneeId !== user.id && task.createdById !== user.id) {
    return apiError("That's someone else's task", 403);
  }

  await prisma.task.delete({ where: { id: task.id } });
  return NextResponse.json({ ok: true });
}
