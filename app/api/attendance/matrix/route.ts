import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { karachiDateString } from "@/lib/attendance-time";

/**
 * Members × days for a month. Returns JSON, or CSV with ?format=csv.
 */
export async function GET(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const year = Number(searchParams.get("year") ?? now.getUTCFullYear());
  const month = Number(searchParams.get("month") ?? now.getUTCMonth() + 1);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return apiError("Invalid period", 422);
  }

  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const members = await prisma.user.findMany({
    where: { role: "MEMBER" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, jobTitle: true, avatarColor: true },
  });

  const records = await prisma.attendanceDay.findMany({
    where: { date: { gte: from, lt: to }, userId: { in: members.map((m) => m.id) } },
    include: { checks: { select: { status: true } } },
  });

  const key = (userId: string, date: string) => `${userId}|${date}`;
  const byKey = new Map(
    records.map((record) => [key(record.userId, karachiDateString(record.date)), record]),
  );

  const dates = Array.from({ length: daysInMonth }, (_, index) =>
    `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`,
  );

  const grid = members.map((member) => ({
    member,
    cells: dates.map((date) => {
      const record = byKey.get(key(member.id, date));
      const resolved = (record?.checks ?? []).filter(
        (check) => check.status === "PASSED" || check.status === "MISSED",
      );

      return {
        date,
        status: record?.status ?? null,
        totalMinutes: record?.totalMinutes ?? null,
        checksPassed: resolved.filter((check) => check.status === "PASSED").length,
        checksTotal: resolved.length,
      };
    }),
  }));

  if (searchParams.get("format") === "csv") {
    const header = ["Member", "Job title", ...dates, "Present", "Late", "Absent", "Hours"];
    const lines = [header.map(csvCell).join(",")];

    for (const row of grid) {
      const counts = {
        present: row.cells.filter((cell) => cell.status === "PRESENT").length,
        late: row.cells.filter((cell) => cell.status === "LATE").length,
        absent: row.cells.filter((cell) => cell.status === "ABSENT").length,
        minutes: row.cells.reduce((sum, cell) => sum + (cell.totalMinutes ?? 0), 0),
      };

      lines.push(
        [
          row.member.name,
          row.member.jobTitle,
          ...row.cells.map((cell) => cell.status ?? ""),
          String(counts.present),
          String(counts.late),
          String(counts.absent),
          (counts.minutes / 60).toFixed(1),
        ]
          .map(csvCell)
          .join(","),
      );
    }

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="attendance-${year}-${String(month).padStart(2, "0")}.csv"`,
      },
    });
  }

  return NextResponse.json({ period: { year, month }, dates, grid });
}

/**
 * A leading =, +, - or @ makes a spreadsheet treat a cell as a formula, so a
 * name like "=cmd()" would execute on open. Prefixing with an apostrophe is the
 * standard defence, and quotes are doubled per RFC 4180.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}
