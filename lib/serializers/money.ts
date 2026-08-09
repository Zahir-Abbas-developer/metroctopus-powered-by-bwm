import type { Viewer } from "@/lib/visibility";
import { canSeeAgencyMoney, canSeeIncentiveAmounts, canSeeOwnStreak } from "@/lib/visibility";

/**
 * Agency money: retainer payments, collections, MRR, bonus amounts.
 *
 * There is no partial view of these. Unlike a client record, which splits into
 * "who they are" and "what they pay", a payment row *is* the money — so these
 * serializers return null for a non-owner and the caller renders nothing.
 * Returning an emptied object would invite a component to draw an MRR chart
 * with no data in it, which reads as "the agency earned nothing".
 */

export function serializePayment<T>(payment: T, viewer: Viewer): T | null {
  return canSeeAgencyMoney(viewer) ? payment : null;
}

export function serializePayments<T>(payments: readonly T[], viewer: Viewer): T[] {
  return canSeeAgencyMoney(viewer) ? [...payments] : [];
}

export function serializeMrr<T>(snapshot: T, viewer: Viewer): T | null {
  return canSeeAgencyMoney(viewer) ? snapshot : null;
}

export type IncentiveSource = {
  userId: string;
  type: string;
  year: number;
  month: number;
  /** Payroll reference only — this app never moves money. */
  amount?: number | null;
  percent?: number | null;
  streakMonths?: number;
  [key: string]: unknown;
};

export type SerializedIncentive = Omit<IncentiveSource, "amount" | "percent"> & {
  amount?: number | null;
  percent?: number | null;
};

/**
 * An incentive award.
 *
 * A member sees that they earned one and how long their streak is — that is
 * the part which changes behaviour. What it is worth is payroll, and payroll
 * is the owner's. Someone else's award is not visible at all.
 */
export function serializeIncentive(
  award: IncentiveSource,
  viewer: Viewer,
): SerializedIncentive | null {
  if (!canSeeOwnStreak(viewer, award.userId)) return null;

  const { amount, percent, ...rest } = award;
  const result: SerializedIncentive = { ...rest };

  if (canSeeIncentiveAmounts(viewer)) {
    result.amount = amount;
    result.percent = percent;
  }

  return result;
}

export const serializeIncentives = (
  awards: readonly IncentiveSource[],
  viewer: Viewer,
): SerializedIncentive[] =>
  awards
    .map((award) => serializeIncentive(award, viewer))
    .filter((award): award is SerializedIncentive => award !== null);
