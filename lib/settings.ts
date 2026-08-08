import { prisma } from "@/lib/prisma";
import { parseWorkdays } from "@/lib/attendance-time";

/**
 * Agency configuration.
 *
 * A single row, created on first read, so a fresh database needs no seeding
 * step before attendance works. The defaults here mirror the column defaults in
 * the schema; both exist because the schema defaults protect direct inserts and
 * these protect a row that predates a newly added column.
 */

export type AgencySettings = {
  shiftStartMinutes: number;
  shiftEndMinutes: number;
  clockInOpensMinutes: number;
  graceMinutes: number;
  absentCutoffMinutes: number;
  checksPerDay: number;
  checkWindowMinutes: number;
  checkEarliestOffsetMinutes: number;
  checkLatestMinutes: number;
  checkMinGapMinutes: number;
  penaltyLateClockIn: number;
  penaltyAbsentDay: number;
  penaltyMissedCheck: number;
  workdays: number[];
};

export const DEFAULT_SETTINGS: AgencySettings = {
  shiftStartMinutes: 12 * 60,
  shiftEndMinutes: 22 * 60,
  clockInOpensMinutes: 11 * 60 + 30,
  graceMinutes: 15,
  absentCutoffMinutes: 15 * 60,
  checksPerDay: 3,
  checkWindowMinutes: 60,
  checkEarliestOffsetMinutes: 45,
  checkLatestMinutes: 21 * 60,
  checkMinGapMinutes: 90,
  penaltyLateClockIn: 0.5,
  penaltyAbsentDay: 3,
  penaltyMissedCheck: 1,
  workdays: [1, 2, 3, 4, 5, 6],
};

export async function getSettings(): Promise<AgencySettings> {
  const row = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  return {
    shiftStartMinutes: row.shiftStartMinutes,
    shiftEndMinutes: row.shiftEndMinutes,
    clockInOpensMinutes: row.clockInOpensMinutes,
    graceMinutes: row.graceMinutes,
    absentCutoffMinutes: row.absentCutoffMinutes,
    checksPerDay: row.checksPerDay,
    checkWindowMinutes: row.checkWindowMinutes,
    checkEarliestOffsetMinutes: row.checkEarliestOffsetMinutes,
    checkLatestMinutes: row.checkLatestMinutes,
    checkMinGapMinutes: row.checkMinGapMinutes,
    penaltyLateClockIn: row.penaltyLateClockIn,
    penaltyAbsentDay: row.penaltyAbsentDay,
    penaltyMissedCheck: row.penaltyMissedCheck,
    workdays: parseWorkdays(row.workdays),
  };
}

/**
 * The latest a check may be scheduled so its window still closes by the end of
 * the shift.
 *
 * Derived rather than trusted: an owner who sets the window to 120 minutes
 * without touching `checkLatestMinutes` would otherwise create checks that
 * expire after everyone has gone home, and every one of them would be missed
 * through no fault of the member.
 */
export function effectiveCheckLatest(settings: AgencySettings): number {
  return Math.min(
    settings.checkLatestMinutes,
    settings.shiftEndMinutes - settings.checkWindowMinutes,
  );
}
