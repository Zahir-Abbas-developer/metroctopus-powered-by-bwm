import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { clockIn, clockOut, dayKind, settleChecks } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { visibleChecks, visibleTally } from "@/lib/attendance-visibility";
import { karachiDay, karachiMinutes } from "@/lib/attendance-time";

/**
 * The member's own day: state, clock-in, clock-out.
 *
 * Every response is assembled through lib/attendance-visibility.ts, so a
 * scheduled check can never reach the browser. That is the feature's core
 * guarantee and it is enforced here, not in the component.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const now = new Date();

  // Reading state is also what advances it — see the note in lib/attendance.ts.
  await settleChecks({ userId: user.id, now });

  const settings = await getSettings();
  const day = karachiDay(now);
  const kind = await dayKind(user.id, now, settings);

  const record = await prisma.attendanceDay.findUnique({
    where: { userId_date: { userId: user.id, date: day } },
    include: { checks: true },
  });

  const active = record?.checks.find((check) => check.status === "ACTIVE") ?? null;

  return NextResponse.json({
    serverNow: now.toISOString(),
    karachiMinutes: karachiMinutes(now),
    dayKind: kind.kind,
    settings: {
      shiftStartMinutes: settings.shiftStartMinutes,
      shiftEndMinutes: settings.shiftEndMinutes,
      clockInOpensMinutes: settings.clockInOpensMinutes,
      graceMinutes: settings.graceMinutes,
      absentCutoffMinutes: settings.absentCutoffMinutes,
      checkWindowMinutes: settings.checkWindowMinutes,
      // checksPerDay is deliberately absent: knowing three are coming and two
      // have fired tells a member the third is still ahead of them.
    },
    day: record
      ? {
          id: record.id,
          status: record.status,
          clockInAt: record.clockInAt?.toISOString() ?? null,
          clockOutAt: record.clockOutAt?.toISOString() ?? null,
          totalMinutes: record.totalMinutes,
          autoClosed: record.autoClosed,
        }
      : null,
    // Resolved checks only. Never the pending ones.
    checks: record ? visibleChecks(record.checks) : [],
    tally: record ? visibleTally(record.checks) : { passed: 0, missed: 0, cancelled: 0, resolved: 0 },
    activeCheck: active
      ? {
          id: active.id,
          scheduledAt: active.scheduledAt.toISOString(),
          windowEndsAt: active.windowEndsAt.toISOString(),
        }
      : null,
  });
}

/** Clock in or out. The action is in the body so one route owns the day. */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const action = (body as { action?: string })?.action;

  if (action === "CLOCK_IN") {
    const result = await clockIn(user.id);
    if (!result.ok) return apiError(result.reason, 409);

    return NextResponse.json({
      ok: true,
      status: result.status,
      late: result.late,
      // A boolean, not a count. Knowing the day is being checked is the
      // deterrent and is meant to be public; knowing that three were scheduled
      // would let a member subtract the two that have fired and conclude they
      // are free for the rest of the afternoon. Same reason `checksPerDay` is
      // withheld from the GET above.
      monitored: result.checksCreated > 0,
    });
  }

  if (action === "CLOCK_OUT") {
    const result = await clockOut(user.id);
    if (!result.ok) return apiError(result.reason, 409);

    return NextResponse.json({
      ok: true,
      totalMinutes: result.totalMinutes,
      cancelledChecks: result.cancelledChecks,
    });
  }

  return apiError("Unknown action", 422, { action: "Expected CLOCK_IN or CLOCK_OUT" });
}
