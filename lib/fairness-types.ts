/**
 * The client-safe vocabulary of Phase 8: block reasons, review ages and their
 * labels.
 *
 * Split out from lib/blocking.ts and lib/review-sla.ts for the same reason
 * lib/report-types.ts exists — those modules reach Prisma, notifications and
 * (through lib/reach.ts) the web-push library. A client component importing a
 * label from them drags all of that into the browser bundle, which fails the
 * build at `require("https")`. Anything a "use client" file needs lives here.
 *
 * No imports. That is the point.
 */

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

export const BLOCK_REASONS = ["CLIENT", "INTERNAL_DEPENDENCY", "EXTERNAL"] as const;
export type BlockReason = (typeof BLOCK_REASONS)[number];

export const BLOCK_REASON_LABEL: Record<BlockReason, string> = {
  CLIENT: "Waiting on client",
  INTERNAL_DEPENDENCY: "Waiting on the team",
  EXTERNAL: "External blocker",
};

export function isBlockReason(value: string): value is BlockReason {
  return (BLOCK_REASONS as readonly string[]).includes(value);
}

/** "2 days" / "5 hours" — how far a deadline moved. */
export function describeBlocked(minutes: number): string {
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(minutes / (60 * 24));
  return `${days} day${days === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// Review SLA
// ---------------------------------------------------------------------------

export type ReviewAge = "FRESH" | "AGEING" | "STALE";

export const REVIEW_AGE_TONE: Record<ReviewAge, "success" | "warning" | "danger"> = {
  FRESH: "success",
  AGEING: "warning",
  STALE: "danger",
};

export const REVIEW_AGE_LABEL: Record<ReviewAge, string> = {
  FRESH: "Under 24h",
  AGEING: "24–48h",
  STALE: "Over 48h",
};

/** Green under a day, amber to two days, red past that. */
export function reviewAge(hours: number): ReviewAge {
  if (hours < 24) return "FRESH";
  if (hours < 48) return "AGEING";
  return "STALE";
}
