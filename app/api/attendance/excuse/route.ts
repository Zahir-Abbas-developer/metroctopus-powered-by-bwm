import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { agencyYearMonth } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { SCORE_EVENT_LABEL, isAttendanceEvent, type ScoreEventType } from "@/lib/scoring";

const excuseSchema = z.object({
  /** The attendance ScoreEvent being excused. */
  scoreEventId: z.string().min(1),
  reason: z
    .string()
    .trim()
    .min(5, "Say why this is being excused — it goes on the permanent record")
    .max(500, "Keep it under 500 characters"),
});

/**
 * Excuses an attendance penalty.
 *
 * The original event is never deleted or edited. A compensating MANUAL_ADJUST
 * of the exact opposite value is written alongside it, so the ledger still
 * shows what happened *and* that the owner set it aside — which is the whole
 * point of an append-only ledger. Deleting would erase the fact that someone
 * was late, and with it any pattern worth noticing.
 */
export async function POST(request: Request) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = excuseSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const original = await prisma.scoreEvent.findUnique({
    where: { id: parsed.data.scoreEventId },
    include: { user: { select: { id: true, name: true } } },
  });

  if (!original) return apiError("That score event no longer exists", 404);

  if (!isAttendanceEvent(original.type)) {
    return apiError("Only attendance penalties can be excused here", 422, {
      scoreEventId: "Not an attendance event",
    });
  }

  if (original.points >= 0) {
    return apiError("That event isn't a penalty", 422);
  }

  const dedupeKey = `excuse:${original.id}`;

  const already = await prisma.scoreEvent.findUnique({ where: { dedupeKey } });
  if (already) {
    return apiError("That penalty has already been excused", 409);
  }

  const cycle = agencyYearMonth(original.createdAt);
  const label = SCORE_EVENT_LABEL[original.type as ScoreEventType];

  const reversal = await prisma.scoreEvent.create({
    data: {
      userId: original.userId,
      milestoneId: null,
      type: "MANUAL_ADJUST",
      // Exactly cancels the original, so the month's total is as if it had not
      // happened — while both rows remain visible.
      points: Math.abs(original.points),
      reason: `Excused: ${label.toLowerCase()} — ${parsed.data.reason}`,
      // Charged to the same cycle as the original, so excusing a late start in
      // early September cannot silently credit August's score.
      year: cycle.year,
      month: cycle.month,
      dedupeKey,
      createdById: admin!.id,
    },
  });

  await notify({
    userId: original.userId,
    type: "WORK_APPROVED",
    title: "Attendance penalty excused",
    body: `${label} was excused: ${parsed.data.reason}`,
    href: "/my-performance",
  });

  return NextResponse.json({ reversal }, { status: 201 });
}
