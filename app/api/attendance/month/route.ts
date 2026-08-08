import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { settleChecks } from "@/lib/attendance";
import { visibleChecks, visibleTally } from "@/lib/attendance-visibility";
import { karachiDateString } from "@/lib/attendance-time";

/**
 * A member's month, for the calendar.
 *
 * An admin may pass ?userId= to read someone else's; a member's own id is
 * forced regardless of what they send.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const now = new Date();

  const year = Number(searchParams.get("year") ?? now.getUTCFullYear());
  const month = Number(searchParams.get("month") ?? now.getUTCMonth() + 1);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return apiError("Invalid period", 422);
  }

  const requested = searchParams.get("userId");
  const userId = user.role === "ADMIN" && requested ? requested : user.id;

  await settleChecks({ userId, now });

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));

  const days = await prisma.attendanceDay.findMany({
    where: { userId, date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
    include: { checks: true },
  });

  const leave = await prisma.leaveRequest.findMany({
    where: { userId, date: { gte: from, lt: to } },
    orderBy: { date: "asc" },
  });

  const worked = days.filter((day) => day.status === "PRESENT" || day.status === "LATE");
  const expected = days.filter((day) => day.status !== "OFF" && day.status !== "LEAVE");
  const allChecks = days.flatMap((day) => day.checks);
  const resolved = allChecks.filter(
    (check) => check.status === "PASSED" || check.status === "MISSED",
  );

  return NextResponse.json({
    period: { year, month },
    days: days.map((day) => ({
      date: karachiDateString(day.date),
      status: day.status,
      clockInAt: day.clockInAt?.toISOString() ?? null,
      clockOutAt: day.clockOutAt?.toISOString() ?? null,
      totalMinutes: day.totalMinutes,
      autoClosed: day.autoClosed,
      // Past days are resolved, so their times are history. Today's pending
      // checks are still filtered out by visibleChecks.
      checks: visibleChecks(day.checks),
      tally: visibleTally(day.checks),
    })),
    leave: leave.map((request) => ({
      id: request.id,
      date: karachiDateString(request.date),
      reason: request.reason,
      status: request.status,
    })),
    stats: {
      attendanceRate:
        expected.length === 0 ? null : Math.round((worked.length / expected.length) * 100),
      onTimeRate:
        worked.length === 0
          ? null
          : Math.round(
              (worked.filter((day) => day.status === "PRESENT").length / worked.length) * 100,
            ),
      checksPassed: resolved.filter((check) => check.status === "PASSED").length,
      checksTotal: resolved.length,
      checksRate:
        resolved.length === 0
          ? null
          : Math.round(
              (resolved.filter((check) => check.status === "PASSED").length /
                resolved.length) *
                100,
            ),
      totalMinutes: days.reduce((sum, day) => sum + (day.totalMinutes ?? 0), 0),
      presentDays: worked.length,
      lateDays: days.filter((day) => day.status === "LATE").length,
      absentDays: days.filter((day) => day.status === "ABSENT").length,
      leaveDays: days.filter((day) => day.status === "LEAVE").length,
    },
  });
}
