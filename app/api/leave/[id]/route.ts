import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { notify } from "@/lib/notifications";
import { karachiDateString } from "@/lib/attendance-time";

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
});

/** Approve or reject, recording who decided and when. */
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

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const existing = await prisma.leaveRequest.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That request no longer exists", 404);

  const updated = await prisma.leaveRequest.update({
    where: { id: params.id },
    data: {
      status: parsed.data.status,
      reviewedById: admin!.id,
      reviewedAt: new Date(),
    },
  });

  // An approved day becomes LEAVE, so the sweep does not later mark it absent.
  if (parsed.data.status === "APPROVED") {
    await prisma.attendanceDay.upsert({
      where: { userId_date: { userId: existing.userId, date: existing.date } },
      update: { status: "LEAVE" },
      create: { userId: existing.userId, date: existing.date, status: "LEAVE" },
    });
  }

  await notify({
    userId: existing.userId,
    type: parsed.data.status === "APPROVED" ? "WORK_APPROVED" : "WORK_REJECTED",
    title: `Leave ${parsed.data.status === "APPROVED" ? "approved" : "declined"}`,
    body: `Your request for ${karachiDateString(existing.date)} was ${parsed.data.status.toLowerCase()}.`,
    href: "/my-attendance",
  });

  return NextResponse.json({ request: updated });
}
