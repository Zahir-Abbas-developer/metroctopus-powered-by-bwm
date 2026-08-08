import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { getSettings } from "@/lib/settings";
import { parseWorkdays } from "@/lib/attendance-time";

const minuteOfDay = z.number().int().min(0).max(24 * 60);

const settingsSchema = z
  .object({
    shiftStartMinutes: minuteOfDay,
    shiftEndMinutes: minuteOfDay,
    clockInOpensMinutes: minuteOfDay,
    graceMinutes: z.number().int().min(0).max(240),
    absentCutoffMinutes: minuteOfDay,
    checksPerDay: z.number().int().min(0).max(12),
    checkWindowMinutes: z.number().int().min(5).max(240),
    checkEarliestOffsetMinutes: z.number().int().min(0).max(480),
    checkLatestMinutes: minuteOfDay,
    checkMinGapMinutes: z.number().int().min(5).max(480),
    penaltyLateClockIn: z.number().min(0).max(50),
    penaltyAbsentDay: z.number().min(0).max(50),
    penaltyMissedCheck: z.number().min(0).max(50),
    workdays: z.string().min(1),
    // Phase 8 — fairness settings.
    breakAllowanceMinutes: z.number().int().min(0).max(480),
    outageReportsPerMonth: z.number().int().min(0).max(31),
    outageMaxHours: z.number().int().min(1).max(12),
    reviewSlaHours: z.number().int().min(1).max(336),
    // Phase 9 — pipeline and renewal.
    bonusDealWon: z.number().min(0).max(50),
    bonusTargetMet: z.number().min(0).max(50),
    penaltyTargetMissed: z.number().min(0).max(50),
    targetMissThreshold: z.number().min(0).max(1),
    autoRenewEnabled: z.boolean(),
    carryOverDueDays: z.number().int().min(0).max(28),
    // Phase 10 — quality, money and health.
    bonusQualityHigh: z.number().min(0).max(50),
    penaltyQualityLow: z.number().min(0).max(50),
    defaultTargetRoas: z.number().min(0).max(100),
    roasAlertWeeks: z.number().int().min(1).max(12),
    paymentOverdueDays: z.number().int().min(0).max(90),
    healthWeightDelivery: z.number().int().min(0).max(100),
    healthWeightRoas: z.number().int().min(0).max(100),
    healthWeightPayment: z.number().int().min(0).max(100),
    healthWeightBlocked: z.number().int().min(0).max(100),
  })
  .partial()
  // Cross-field rules, because a setting that is individually valid can still
  // describe an impossible day.
  .refine(
    (value) =>
      value.shiftStartMinutes === undefined ||
      value.shiftEndMinutes === undefined ||
      value.shiftEndMinutes > value.shiftStartMinutes,
    { message: "The shift must end after it starts", path: ["shiftEndMinutes"] },
  )
  .refine(
    (value) =>
      value.clockInOpensMinutes === undefined ||
      value.shiftStartMinutes === undefined ||
      value.clockInOpensMinutes <= value.shiftStartMinutes,
    { message: "Clock-in cannot open after the shift starts", path: ["clockInOpensMinutes"] },
  )
  .refine((value) => value.workdays === undefined || parseWorkdays(value.workdays).length > 0, {
    message: "Pick at least one working day",
    path: ["workdays"],
  });

export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  const settings = await getSettings();
  return NextResponse.json({ settings: { ...settings, workdays: settings.workdays.join(",") } });
}

export async function PATCH(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = settingsSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  // Validate the merged result, not just the patch: changing only the shift end
  // must still be checked against the stored shift start.
  const current = await getSettings();
  const merged = { ...current, ...parsed.data, workdays: parsed.data.workdays ?? current.workdays.join(",") };

  if (merged.shiftEndMinutes <= merged.shiftStartMinutes) {
    return apiError("The shift must end after it starts", 422, {
      shiftEndMinutes: "Must be after the start",
    });
  }
  if (merged.absentCutoffMinutes <= merged.shiftStartMinutes) {
    return apiError("The absent cutoff must be after the shift starts", 422, {
      absentCutoffMinutes: "Must be after the start",
    });
  }
  if (merged.checkLatestMinutes + merged.checkWindowMinutes > merged.shiftEndMinutes) {
    return apiError(
      "A check's window would end after the shift does — lower the latest check time or shorten the window",
      422,
      { checkLatestMinutes: "Window would run past the shift" },
    );
  }

  try {
    await prisma.settings.upsert({
      where: { id: "singleton" },
      update: parsed.data,
      create: { id: "singleton", ...parsed.data },
    });

    const settings = await getSettings();
    return NextResponse.json({
      settings: { ...settings, workdays: settings.workdays.join(",") },
    });
  } catch {
    return apiError("Couldn't save those settings", 500);
  }
}
