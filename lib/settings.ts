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
  // Phase 8 — fairness settings.
  breakAllowanceMinutes: number;
  outageReportsPerMonth: number;
  outageMaxHours: number;
  reviewSlaHours: number;
  // Phase 9 — pipeline and renewal.
  bonusDealWon: number;
  bonusTargetMet: number;
  penaltyTargetMissed: number;
  targetMissThreshold: number;
  autoRenewEnabled: boolean;
  carryOverDueDays: number;
  // Phase 10 — quality, money and health.
  bonusQualityHigh: number;
  penaltyQualityLow: number;
  defaultTargetRoas: number;
  roasAlertWeeks: number;
  paymentOverdueDays: number;
  healthWeightDelivery: number;
  healthWeightRoas: number;
  healthWeightPayment: number;
  healthWeightBlocked: number;
  // Phase 11 — delegation, incentives and culture.
  leadEscalationHours: number;
  bonusThresholdScore: number;
  bonusStreakMonths: number;
  defaultBonusPercent: number;
  reviewThresholdScore: number;
  reviewWindowMonths: number;
  reviewTriggerCount: number;
  disputeWindowDays: number;
  disputeSlaHours: number;
  leaderboardVisibility: string;
  backupWarnHours: number;
  /** IANA zone the whole app reasons in (Doctrine 6). */
  timezone: string;
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
  breakAllowanceMinutes: 90,
  outageReportsPerMonth: 4,
  outageMaxHours: 4,
  reviewSlaHours: 48,
  bonusDealWon: 3,
  bonusTargetMet: 1,
  penaltyTargetMissed: 1,
  targetMissThreshold: 0.6,
  autoRenewEnabled: true,
  carryOverDueDays: 5,
  bonusQualityHigh: 0.5,
  penaltyQualityLow: 1,
  defaultTargetRoas: 3,
  roasAlertWeeks: 2,
  paymentOverdueDays: 7,
  healthWeightDelivery: 35,
  healthWeightRoas: 30,
  healthWeightPayment: 20,
  healthWeightBlocked: 15,
  leadEscalationHours: 24,
  bonusThresholdScore: 90,
  bonusStreakMonths: 3,
  defaultBonusPercent: 10,
  reviewThresholdScore: 60,
  reviewWindowMonths: 3,
  reviewTriggerCount: 2,
  disputeWindowDays: 7,
  disputeSlaHours: 72,
  leaderboardVisibility: "ADMIN_ONLY",
  backupWarnHours: 26,
  timezone: "America/New_York",
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
    breakAllowanceMinutes: row.breakAllowanceMinutes,
    outageReportsPerMonth: row.outageReportsPerMonth,
    outageMaxHours: row.outageMaxHours,
    reviewSlaHours: row.reviewSlaHours,
    bonusDealWon: row.bonusDealWon,
    bonusTargetMet: row.bonusTargetMet,
    penaltyTargetMissed: row.penaltyTargetMissed,
    targetMissThreshold: row.targetMissThreshold,
    autoRenewEnabled: row.autoRenewEnabled,
    carryOverDueDays: row.carryOverDueDays,
    bonusQualityHigh: row.bonusQualityHigh,
    penaltyQualityLow: row.penaltyQualityLow,
    defaultTargetRoas: row.defaultTargetRoas,
    roasAlertWeeks: row.roasAlertWeeks,
    paymentOverdueDays: row.paymentOverdueDays,
    healthWeightDelivery: row.healthWeightDelivery,
    healthWeightRoas: row.healthWeightRoas,
    healthWeightPayment: row.healthWeightPayment,
    healthWeightBlocked: row.healthWeightBlocked,
    leadEscalationHours: row.leadEscalationHours,
    bonusThresholdScore: row.bonusThresholdScore,
    bonusStreakMonths: row.bonusStreakMonths,
    defaultBonusPercent: row.defaultBonusPercent,
    reviewThresholdScore: row.reviewThresholdScore,
    reviewWindowMonths: row.reviewWindowMonths,
    reviewTriggerCount: row.reviewTriggerCount,
    disputeWindowDays: row.disputeWindowDays,
    disputeSlaHours: row.disputeSlaHours,
    leaderboardVisibility: row.leaderboardVisibility,
    backupWarnHours: row.backupWarnHours,
    timezone: row.timezone,
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
/** The health weights, in the shape lib/clientHealth.ts expects. */
export function healthWeightsFrom(settings: AgencySettings) {
  return {
    delivery: settings.healthWeightDelivery,
    roas: settings.healthWeightRoas,
    payment: settings.healthWeightPayment,
    blocked: settings.healthWeightBlocked,
  };
}

/** The incentive rules, in the shape lib/incentives.ts expects. */
export function incentiveConfigFrom(settings: AgencySettings) {
  return {
    bonusThresholdScore: settings.bonusThresholdScore,
    bonusStreakMonths: settings.bonusStreakMonths,
    reviewThresholdScore: settings.reviewThresholdScore,
    reviewWindowMonths: settings.reviewWindowMonths,
    reviewTriggerCount: settings.reviewTriggerCount,
  };
}

export function effectiveCheckLatest(settings: AgencySettings): number {
  return Math.min(
    settings.checkLatestMinutes,
    settings.shiftEndMinutes - settings.checkWindowMinutes,
  );
}
