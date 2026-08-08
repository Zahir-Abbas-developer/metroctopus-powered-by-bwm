import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { karachiDateString, karachiDay } from "@/lib/attendance-time";
import { notify } from "@/lib/notifications";

const leaveSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date"),
  reason: z
    .string()
    .trim()
    .min(5, "Say why — the owner needs something to approve")
    .max(500, "Keep it under 500 characters"),
});

/** A member's own requests; the owner sees everyone's. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const requests = await prisma.leaveRequest.findMany({
    where: user.role === "ADMIN" ? {} : { userId: user.id },
    orderBy: [{ status: "asc" }, { date: "desc" }],
    take: 200,
    include: {
      user: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      reviewedBy: { select: { name: true } },
    },
  });

  return NextResponse.json({
    requests: requests.map((request) => ({
      id: request.id,
      date: karachiDateString(request.date),
      reason: request.reason,
      status: request.status,
      member: request.user,
      reviewedBy: request.reviewedBy?.name ?? null,
      reviewedAt: request.reviewedAt?.toISOString() ?? null,
      createdAt: request.createdAt.toISOString(),
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = leaveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const date = parseDateInput(parsed.data.date);
  if (!date) return apiError("Pick a valid date", 422, { date: "Use a valid date" });

  // Leave is a request to be excused in advance. Backdating it would let
  // someone paper over an absence that has already been charged.
  if (karachiDay(date) < karachiDay(new Date())) {
    return apiError("Leave can only be requested for today or later", 422, {
      date: "That date has passed",
    });
  }

  try {
    const created = await prisma.leaveRequest.create({
      data: { userId: user.id, date, reason: parsed.data.reason },
    });

    const owners = await prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    });

    for (const owner of owners) {
      await notify({
        userId: owner.id,
        type: "TASK_ASSIGNED",
        title: "Leave request",
        body: `${user.name ?? "A member"} asked for ${parsed.data.date} off: ${parsed.data.reason}`,
        href: "/attendance",
      });
    }

    return NextResponse.json({ request: created }, { status: 201 });
  } catch {
    return apiError("You already have a request for that date", 409, {
      date: "Already requested",
    });
  }
}
