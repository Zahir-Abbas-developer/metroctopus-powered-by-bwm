import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { settleChecks, dayKind } from "@/lib/attendance";
import { getSettings } from "@/lib/settings";
import { adminTally } from "@/lib/attendance-visibility";
import { breakAllowance, breakMinutesUsed } from "@/lib/fairness-windows";
import { karachiDay, karachiMinutes, minutesBetween } from "@/lib/attendance-time";

/** Today's live board: who is actually working right now. */
export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  const now = new Date();
  await settleChecks({ now });

  const settings = await getSettings();
  const day = karachiDay(now);

  const members = await prisma.user.findMany({
    where: { role: "MEMBER", isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, jobTitle: true, avatarColor: true },
  });

  const days = await prisma.attendanceDay.findMany({
    where: { date: day, userId: { in: members.map((m) => m.id) } },
    include: { checks: true },
  });

  const byUser = new Map(days.map((record) => [record.userId, record]));

  // Break state for the whole team in one query — the board refreshes every
  // minute, so a per-member round trip would be five queries a minute for a
  // number that is almost always zero.
  const breakSessions = await prisma.breakSession.findMany({
    where: { date: day, userId: { in: members.map((m) => m.id) } },
  });
  const breaksByUser = new Map<string, typeof breakSessions>();
  for (const session of breakSessions) {
    breaksByUser.set(session.userId, [...(breaksByUser.get(session.userId) ?? []), session]);
  }

  const rows = [];
  for (const member of members) {
    const record = byUser.get(member.id);
    const kind = await dayKind(member.id, now, settings);

    rows.push({
      id: member.id,
      name: member.name,
      jobTitle: member.jobTitle,
      avatarColor: member.avatarColor,
      dayKind: kind.kind,
      status: record?.status ?? (kind.kind === "WORKDAY" ? "NOT_STARTED" : kind.kind),
      clockInAt: record?.clockInAt?.toISOString() ?? null,
      clockOutAt: record?.clockOutAt?.toISOString() ?? null,
      autoClosed: record?.autoClosed ?? false,
      // Live, so the board shows time accruing rather than a stale total.
      minutesWorked: record?.clockInAt
        ? minutesBetween(record.clockInAt, record.clockOutAt ?? now)
        : 0,
      // Counts and states only. The owner never sees the scheduled times
      // either — a shared screen would otherwise hand out the day's answers.
      checks: record ? adminTally(record.checks) : adminTally([]),
      // Protected time. Shown so the owner knows why nobody is answering, and
      // amber over allowance — never a penalty, only a fact.
      breaks: (() => {
        const sessions = breaksByUser.get(member.id) ?? [];
        const open = sessions.find((session) => !session.endedAt) ?? null;
        const used = breakMinutesUsed(sessions, now);
        const allowance = breakAllowance(used, settings.breakAllowanceMinutes);
        return {
          onBreak: Boolean(open),
          reason: open?.reason ?? null,
          usedMinutes: used,
          allowanceMinutes: allowance.allowance,
          exceeded: allowance.exceeded,
        };
      })(),
    });
  }

  const working = rows.filter((row) => row.clockInAt && !row.clockOutAt).length;

  return NextResponse.json({
    serverNow: now.toISOString(),
    karachiMinutes: karachiMinutes(now),
    shift: {
      startMinutes: settings.shiftStartMinutes,
      endMinutes: settings.shiftEndMinutes,
      absentCutoffMinutes: settings.absentCutoffMinutes,
    },
    summary: {
      total: rows.length,
      working,
      notStarted: rows.filter((row) => row.status === "NOT_STARTED").length,
      absent: rows.filter((row) => row.status === "ABSENT").length,
      onLeave: rows.filter((row) => row.status === "LEAVE").length,
      off: rows.filter((row) => row.status === "OFF").length,
      onBreak: rows.filter((row) => row.breaks.onBreak).length,
    },
    rows,
  });
}
