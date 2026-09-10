import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { canUseDepartment } from "@/lib/departments";
import { addDays, parseDateInput, toDateOnly } from "@/lib/date";
import {
  hasAdminPower,
  LOGGABLE_ACTIVITY_TYPES,
  type ActivityType,
} from "@/lib/constants";

/**
 * What happens when a follow-up comes due.
 *
 * Two actions, and the second one is the point of the whole feature:
 *
 * - **snooze** pushes the date out. It is honest about the fact that "not
 *   today" is a real answer, and stops people clearing a follow-up they have
 *   not actually done just to get it off the list.
 * - **log outcome** records what was said *and* asks when to speak next. It
 *   deliberately cannot clear the date without either a new one or an explicit
 *   `close`, because a follow-up cleared with nothing after it is exactly how a
 *   lead goes silent — which is the failure this feature exists to prevent.
 */

const bodySchema = z
  .object({
    type: z.enum(["LEAD", "CLIENT"]),
    recordId: z.string().min(1),
    action: z.enum(["snooze", "log"]),
    /** snooze: how far out. */
    days: z.number().int().min(1).max(365).optional(),
    /** log: what happened. */
    activityType: z.enum(LOGGABLE_ACTIVITY_TYPES as unknown as [ActivityType, ...ActivityType[]]).optional(),
    note: z.string().trim().max(2000).optional(),
    /** log: when to speak next, `YYYY-MM-DD`. */
    nextFollowUpAt: z.string().trim().nullish(),
    /** log: deliberately stop following this record up. */
    close: z.boolean().optional(),
  })
  .refine((value) => value.action !== "snooze" || value.days !== undefined, {
    message: "How long for?",
    path: ["days"],
  })
  .refine(
    (value) =>
      value.action !== "log" || Boolean(value.nextFollowUpAt) || value.close === true,
    {
      message: "Set the next follow-up, or say you're closing it out",
      path: ["nextFollowUpAt"],
    },
  );

export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const data = parsed.data;
  const isAdmin = hasAdminPower(user.role);

  const record =
    data.type === "LEAD"
      ? await prisma.lead.findUnique({
          where: { id: data.recordId },
          select: {
            id: true,
            departmentId: true,
            businessName: true,
            ownerId: true,
            nextFollowUpAt: true,
          },
        })
      : await prisma.client.findUnique({
          where: { id: data.recordId },
          select: {
            id: true,
            departmentId: true,
            businessName: true,
            assigneeId: true,
            nextFollowUpAt: true,
          },
        });

  if (!record) return apiError("That record no longer exists", 404);

  if (!(await canUseDepartment(user.id, isAdmin, record.departmentId))) {
    return apiError("That department isn't one of yours", 403);
  }

  const ownerId = "ownerId" in record ? record.ownerId : record.assigneeId;
  if (!isAdmin && ownerId !== user.id) {
    return apiError("That's someone else's follow-up", 403);
  }

  let nextFollowUpAt: Date | null;

  if (data.action === "snooze") {
    // Snooze from the date it was due, not from now: three snoozes of a day
    // each should land three days after the original date, not three days after
    // whenever somebody last clicked.
    const from = record.nextFollowUpAt ?? new Date();
    nextFollowUpAt = toDateOnly(addDays(from, data.days!));
  } else {
    if (data.close) {
      nextFollowUpAt = null;
    } else {
      const parsedDate = parseDateInput(data.nextFollowUpAt!);
      if (!parsedDate) {
        return apiError("Please fix the highlighted fields", 422, {
          nextFollowUpAt: "That isn't a date we can read",
        });
      }
      nextFollowUpAt = parsedDate;
    }
  }

  const activityNote =
    data.action === "snooze"
      ? `Follow-up moved out ${data.days} day${data.days === 1 ? "" : "s"}`
      : (data.note?.trim() ||
        (data.close ? "Closed out — no further follow-up" : "Follow-up logged"));

  await prisma.$transaction([
    data.type === "LEAD"
      ? prisma.lead.update({ where: { id: record.id }, data: { nextFollowUpAt } })
      : prisma.client.update({ where: { id: record.id }, data: { nextFollowUpAt } }),
    prisma.salesActivity.create({
      data: {
        departmentId: record.departmentId,
        leadId: data.type === "LEAD" ? record.id : null,
        clientId: data.type === "CLIENT" ? record.id : null,
        userId: user.id,
        type: data.action === "snooze" ? "FOLLOW_UP" : (data.activityType ?? "NOTE"),
        // A snooze is the app recording a decision; a logged outcome is a
        // person saying what happened. The timeline shows them differently.
        isSystem: data.action === "snooze",
        note: activityNote,
      },
    }),
  ]);

  return NextResponse.json({
    nextFollowUpAt: nextFollowUpAt?.toISOString() ?? null,
  });
}
