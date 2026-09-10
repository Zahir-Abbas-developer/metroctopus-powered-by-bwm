import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { taskBoard } from "@/lib/tasks";
import { canUseDepartment } from "@/lib/departments";
import { canBeAssigned } from "@/lib/assignment";
import { parseDateInput } from "@/lib/date";
import { hasAdminPower, TASK_PRIORITIES } from "@/lib/constants";

/**
 * The daily working surface: everything owed, in buckets.
 *
 * Department-scoped, so this list cannot become a way to read another business
 * line's client names — a task title carries one.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const priority = searchParams.get("priority");

  const { rows, timeZone } = await taskBoard(user.id, hasAdminPower(user.role), {
    departmentId: searchParams.get("departmentId"),
    assigneeId: searchParams.get("assigneeId"),
    priority:
      priority && (TASK_PRIORITIES as readonly string[]).includes(priority)
        ? (priority as (typeof TASK_PRIORITIES)[number])
        : null,
    mineOnly: searchParams.get("mine") === "1",
  });

  return NextResponse.json({
    tasks: rows,
    timeZone,
    viewer: { id: user.id, isAdmin: hasAdminPower(user.role) },
  });
}

const createSchema = z
  .object({
    title: z.string().trim().min(2, "Give the task a title").max(160),
    note: z.string().trim().max(2000).nullish(),
    departmentId: z.string().min(1, "Pick a department"),
    leadId: z.string().min(1).nullish(),
    clientId: z.string().min(1).nullish(),
    assigneeId: z.string().min(1).nullish(),
    /** `YYYY-MM-DD`, read on the company clock like every other due date. */
    dueAt: z.string().trim().nullish(),
    priority: z.enum(TASK_PRIORITIES).default("MEDIUM"),
  })
  .refine((value) => !(value.leadId && value.clientId), {
    message: "A task hangs off a lead or a client, not both",
    path: ["leadId"],
  });

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const data = parsed.data;
  const isAdmin = hasAdminPower(user.role);

  if (!(await canUseDepartment(user.id, isAdmin, data.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  // The record a task hangs off must live in the same department, or the task
  // would appear on one board while its subject sits on another.
  if (data.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: data.leadId },
      select: { departmentId: true },
    });
    if (!lead || lead.departmentId !== data.departmentId) {
      return apiError("Please fix the highlighted fields", 422, {
        leadId: "That lead isn't in this department",
      });
    }
  }
  if (data.clientId) {
    const client = await prisma.client.findUnique({
      where: { id: data.clientId },
      select: { departmentId: true },
    });
    if (!client || client.departmentId !== data.departmentId) {
      return apiError("Please fix the highlighted fields", 422, {
        clientId: "That client isn't in this department",
      });
    }
  }

  if (data.assigneeId && !(await canBeAssigned(data.departmentId, data.assigneeId))) {
    return apiError("Please fix the highlighted fields", 422, {
      assigneeId: "That person isn't in this department",
    });
  }

  const dueAt = data.dueAt ? parseDateInput(data.dueAt) : null;
  if (data.dueAt && !dueAt) {
    return apiError("Please fix the highlighted fields", 422, {
      dueAt: "That isn't a date we can read",
    });
  }

  const task = await prisma.task.create({
    data: {
      departmentId: data.departmentId,
      leadId: data.leadId ?? null,
      clientId: data.clientId ?? null,
      title: data.title,
      note: data.note || null,
      // Unassigned work is invisible work. Whoever adds it owns it unless they
      // say otherwise — the same rule leads follow.
      assigneeId: data.assigneeId ?? user.id,
      createdById: user.id,
      dueAt,
      priority: data.priority,
    },
  });

  return NextResponse.json({ task }, { status: 201 });
}
