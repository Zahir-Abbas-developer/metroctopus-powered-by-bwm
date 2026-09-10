import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { canUseDepartment } from "@/lib/departments";
import {
  ACTIVITY_TYPES,
  LOGGABLE_ACTIVITY_TYPES,
  hasAdminPower,
  type ActivityType,
} from "@/lib/constants";

/**
 * The timeline on a lead or a client.
 *
 * One endpoint for both, because a record's history should not change shape
 * when it converts: the calls made while it was a lead are the same calls after
 * it becomes a client, and a separate endpoint per table is how the two drift.
 */

const loggable = LOGGABLE_ACTIVITY_TYPES as unknown as [ActivityType, ...ActivityType[]];

/** Which record, established once and reused by both handlers. */
async function resolveRecord(searchParams: URLSearchParams | Record<string, string>) {
  const get = (key: string) =>
    searchParams instanceof URLSearchParams ? searchParams.get(key) : searchParams[key];

  const leadId = get("leadId");
  const clientId = get("clientId");
  if (!leadId && !clientId) return null;
  if (leadId && clientId) return null;

  if (leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, departmentId: true },
    });
    return lead ? { kind: "LEAD" as const, id: lead.id, departmentId: lead.departmentId } : null;
  }

  const client = await prisma.client.findUnique({
    where: { id: clientId! },
    select: { id: true, departmentId: true },
  });
  return client
    ? { kind: "CLIENT" as const, id: client.id, departmentId: client.departmentId }
    : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const record = await resolveRecord(searchParams);
  if (!record) return apiError("Name exactly one lead or client", 400);

  if (!(await canUseDepartment(user.id, hasAdminPower(user.role), record.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  const type = searchParams.get("type");
  const filtered = type && (ACTIVITY_TYPES as readonly string[]).includes(type) ? type : null;

  const activities = await prisma.salesActivity.findMany({
    where: {
      ...(record.kind === "LEAD" ? { leadId: record.id } : { clientId: record.id }),
      ...(filtered ? { type: filtered } : {}),
    },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 200,
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
  });

  // Counts are of the *whole* timeline, not the filtered slice — a filter chip
  // showing the count of what it would return after you already applied it is
  // no help in deciding whether to apply it.
  const counts = await prisma.salesActivity.groupBy({
    by: ["type"],
    where: record.kind === "LEAD" ? { leadId: record.id } : { clientId: record.id },
    _count: { _all: true },
  });

  return NextResponse.json({
    activities: activities.map((activity) => ({
      id: activity.id,
      type: activity.type,
      note: activity.note,
      isSystem: activity.isSystem,
      occurredAt: activity.occurredAt.toISOString(),
      user: activity.user,
    })),
    counts: Object.fromEntries(counts.map((row) => [row.type, row._count._all])),
  });
}

const logSchema = z.object({
  leadId: z.string().min(1).nullish(),
  clientId: z.string().min(1).nullish(),
  type: z.enum(loggable),
  note: z
    .string()
    .trim()
    .min(3, "A few words on what happened — this is the record")
    .max(2000),
  /** Defaults to now; set when logging something after the fact. */
  occurredAt: z.string().datetime().optional(),
});

/**
 * Logging by hand.
 *
 * Only the loggable types are accepted: STATUS_CHANGE and ASSIGNMENT describe
 * what the app did, and letting a person write one would make the timeline's
 * "system" marker a claim rather than a fact.
 *
 * Anyone in the department may log against any of its records — somebody who
 * takes a call on a colleague's prospect should be able to record it, and the
 * activity is attributed to them rather than to the owner.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = logSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const data = parsed.data;
  const record = await resolveRecord({
    ...(data.leadId ? { leadId: data.leadId } : {}),
    ...(data.clientId ? { clientId: data.clientId } : {}),
  });
  if (!record) return apiError("Name exactly one lead or client", 400);

  if (!(await canUseDepartment(user.id, hasAdminPower(user.role), record.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  const activity = await prisma.salesActivity.create({
    data: {
      departmentId: record.departmentId,
      leadId: record.kind === "LEAD" ? record.id : null,
      clientId: record.kind === "CLIENT" ? record.id : null,
      userId: user.id,
      type: data.type,
      note: data.note,
      isSystem: false,
      ...(data.occurredAt ? { occurredAt: new Date(data.occurredAt) } : {}),
    },
    include: { user: { select: { id: true, name: true, avatarColor: true } } },
  });

  return NextResponse.json({ activity }, { status: 201 });
}

/**
 * Removing a mis-logged entry.
 *
 * Own work only, unless you are an admin: activity counts feed the weekly
 * targets, so deleting somebody else's log would be editing their numbers.
 *
 * A system entry cannot be removed by anyone. "Moved to Quote" is not a claim
 * someone made, it is a record of what the app did — letting it be deleted
 * would turn the timeline from evidence into a draft.
 */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return apiError("Which activity?", 422, { id: "Required" });

  const activity = await prisma.salesActivity.findUnique({
    where: { id },
    select: { id: true, userId: true, departmentId: true, isSystem: true },
  });
  if (!activity) return apiError("That activity no longer exists", 404);

  if (!(await canUseDepartment(user.id, hasAdminPower(user.role), activity.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  if (activity.isSystem) {
    return apiError("Automatic entries are a record of what happened", 403);
  }

  if (!hasAdminPower(user.role) && activity.userId !== user.id) {
    return apiError("You can only remove your own logged activity", 403);
  }

  await prisma.salesActivity.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
