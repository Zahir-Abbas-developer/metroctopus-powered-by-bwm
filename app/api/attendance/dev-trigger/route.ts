import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { settleChecks } from "@/lib/attendance";
import { karachiDay } from "@/lib/attendance-time";

/**
 * Testing aid: pull a member's next scheduled check forward to right now, or
 * expire their active one.
 *
 * Gated hard. In production this would be a way to manufacture or dodge
 * penalties, so it refuses to run unless the deployment has explicitly opted
 * in with ALLOW_TEST_TRIGGERS=1 — being an admin is not enough on its own.
 */
const triggerSchema = z.object({
  userId: z.string().min(1),
  action: z.enum(["TRIGGER_NEXT", "EXPIRE_ACTIVE"]).default("TRIGGER_NEXT"),
});

function testTriggersAllowed(): boolean {
  if (process.env.ALLOW_TEST_TRIGGERS === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  if (!testTriggersAllowed()) {
    return apiError(
      "Test triggers are disabled. Set ALLOW_TEST_TRIGGERS=1 to enable them.",
      403,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = triggerSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const now = new Date();
  const day = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId: parsed.data.userId, date: karachiDay(now) } },
    include: { checks: { orderBy: { scheduledAt: "asc" } } },
  });

  if (!day) return apiError("That member hasn't started their day", 404);

  if (parsed.data.action === "EXPIRE_ACTIVE") {
    const active = day.checks.find((check) => check.status === "ACTIVE");
    if (!active) return apiError("No active check to expire", 404);

    // Move the window into the past; settleChecks does the rest, so expiry
    // follows exactly the same path it would in real life.
    await prisma.availabilityCheck.update({
      where: { id: active.id },
      data: {
        scheduledAt: new Date(now.getTime() - 61 * 60_000),
        windowEndsAt: new Date(now.getTime() - 60_000),
      },
    });

    const settled = await settleChecks({ userId: parsed.data.userId, now });
    return NextResponse.json({ ok: true, action: "EXPIRE_ACTIVE", ...settled });
  }

  const next = day.checks.find((check) => check.status === "SCHEDULED");
  if (!next) return apiError("No scheduled check left today", 404);

  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const windowMinutes = settings?.checkWindowMinutes ?? 60;

  await prisma.availabilityCheck.update({
    where: { id: next.id },
    data: {
      scheduledAt: now,
      windowEndsAt: new Date(now.getTime() + windowMinutes * 60_000),
    },
  });

  const settled = await settleChecks({ userId: parsed.data.userId, now });
  return NextResponse.json({ ok: true, action: "TRIGGER_NEXT", ...settled });
}
