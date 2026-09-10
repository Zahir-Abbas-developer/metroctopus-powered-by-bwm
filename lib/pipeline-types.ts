import type { BadgeTone } from "@/components/ui/Badge";

/**
 * The vocabulary of the sales pipeline.
 *
 * Client-safe by construction — no Prisma, no imports beyond a badge type —
 * for the same reason lib/report-types.ts and lib/fairness-types.ts exist: the
 * kanban, the drawer and the target bar are all client components, and pulling
 * the service layer into the browser bundle is a build error waiting to
 * happen.
 */

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

/** Open stages, in the order a deal moves through them. */
export const OPEN_STAGES = [
  "NEW",
  "CONTACTED",
  "MEETING_BOOKED",
  "PROPOSAL_SENT",
  "NEGOTIATION",
] as const;

export const CLOSED_STAGES = ["WON", "LOST"] as const;

export const LEAD_STAGES = [...OPEN_STAGES, ...CLOSED_STAGES] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  MEETING_BOOKED: "Meeting booked",
  PROPOSAL_SENT: "Proposal sent",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
};

export const STAGE_TONE: Record<LeadStage, BadgeTone> = {
  NEW: "neutral",
  CONTACTED: "info",
  MEETING_BOOKED: "info",
  PROPOSAL_SENT: "warning",
  NEGOTIATION: "warning",
  WON: "success",
  LOST: "danger",
};

export function isLeadStage(value: string): value is LeadStage {
  return (LEAD_STAGES as readonly string[]).includes(value);
}

export function isOpenStage(stage: string): boolean {
  return (OPEN_STAGES as readonly string[]).includes(stage);
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export const LEAD_SOURCES = ["OUTREACH", "REFERRAL", "INBOUND", "SOCIAL"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LEAD_SOURCE_LABEL: Record<LeadSource, string> = {
  OUTREACH: "Cold outreach",
  REFERRAL: "Referral",
  INBOUND: "Inbound",
  SOCIAL: "Social",
};

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/**
 * The original sales-activity vocabulary.
 *
 * Superseded as the *canonical* list by ACTIVITY_TYPES in lib/constants.ts,
 * which T3 widened: it adds NOTE, QUOTE and OTHER for logging by hand, plus
 * STATUS_CHANGE and ASSIGNMENT for events the app writes itself.
 *
 * Kept because rows already carry `DM` and `PROPOSAL_SENT`. Deleting the values
 * would not delete the history — it would leave stored activities that no label
 * renders and no bucket counts, which is a worse outcome than an unused enum.
 * New logging offers LOGGABLE_ACTIVITY_TYPES from lib/constants.ts.
 */
export const ACTIVITY_TYPES = [
  "CALL",
  "EMAIL",
  "DM",
  "MEETING",
  "FOLLOW_UP",
  "PROPOSAL_SENT",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  CALL: "Call",
  EMAIL: "Email",
  DM: "DM",
  MEETING: "Meeting",
  FOLLOW_UP: "Follow-up",
  PROPOSAL_SENT: "Proposal sent",
};

export function isActivityType(value: string): value is ActivityType {
  return (ACTIVITY_TYPES as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Target buckets
// ---------------------------------------------------------------------------

/**
 * Targets are set on buckets, not on raw activity types.
 *
 * "40 outreach a week" is a number a person can hold in their head and act on.
 * "14 calls, 18 emails and 8 DMs" is three targets that trade off against each
 * other, and hitting the number by picking the cheapest channel is a worse
 * outcome than letting them choose. So calls, emails and DMs count together.
 */
export const ACTIVITY_BUCKETS = ["OUTREACH", "FOLLOW_UP", "PROPOSAL", "MEETING"] as const;
export type ActivityBucket = (typeof ACTIVITY_BUCKETS)[number];

export const BUCKET_LABEL: Record<ActivityBucket, string> = {
  OUTREACH: "Outreach",
  FOLLOW_UP: "Follow-ups",
  PROPOSAL: "Proposals",
  MEETING: "Meetings",
};

/** What each bucket counts, for the tooltip under a target bar. */
export const BUCKET_DESCRIPTION: Record<ActivityBucket, string> = {
  OUTREACH: "Calls, emails and DMs to new prospects",
  FOLLOW_UP: "Chasing a conversation already started",
  PROPOSAL: "Proposals sent",
  MEETING: "Calls and meetings actually held",
};

/**
 * Which weekly target an activity counts towards.
 *
 * Keyed by string rather than by the legacy enum so it can cover both
 * vocabularies at once. Historical `DM` and `PROPOSAL_SENT` rows keep counting
 * exactly as they did; T3's `QUOTE` counts as a proposal, because that is what
 * it is under a different name.
 *
 * `STATUS_CHANGE` and `ASSIGNMENT` are deliberately absent: the app writes
 * those itself, and letting them count would let somebody hit an outreach
 * target by dragging a card back and forth.
 */
const BUCKET_OF: Record<string, ActivityBucket> = {
  CALL: "OUTREACH",
  EMAIL: "OUTREACH",
  DM: "OUTREACH",
  FOLLOW_UP: "FOLLOW_UP",
  PROPOSAL_SENT: "PROPOSAL",
  QUOTE: "PROPOSAL",
  MEETING: "MEETING",
};

export function bucketFor(type: string): ActivityBucket | null {
  return BUCKET_OF[type] ?? null;
}

export function isActivityBucket(value: string): value is ActivityBucket {
  return (ACTIVITY_BUCKETS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Loss reasons
// ---------------------------------------------------------------------------

/**
 * A fixed list, because free text is unqueryable and the whole point of
 * recording a loss is being able to count them later. The note beside it
 * carries the detail.
 */
export const LOST_REASONS = [
  "PRICE",
  "TIMING",
  "WENT_ELSEWHERE",
  "NO_RESPONSE",
  "NOT_A_FIT",
  "IN_HOUSE",
  "OTHER",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABEL: Record<LostReason, string> = {
  PRICE: "Too expensive",
  TIMING: "Wrong timing",
  WENT_ELSEWHERE: "Chose a competitor",
  NO_RESPONSE: "Went quiet",
  NOT_A_FIT: "Not a fit",
  IN_HOUSE: "Keeping it in-house",
  OTHER: "Other",
};

export function isLostReason(value: string): value is LostReason {
  return (LOST_REASONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Money formatting
// ---------------------------------------------------------------------------

/**
 * "$4.5k" / "$12,400" — pipeline columns are narrow and a full figure with
 * separators wraps. Anything under 10k keeps its exact value because the
 * difference between $4,500 and $4,900 is a real one at this size of agency.
 */
export function formatMoney(amount: number, compact = false): string {
  if (!compact || Math.abs(amount) < 10_000) {
    return `$${amount.toLocaleString("en-US")}`;
  }
  const thousands = amount / 1000;
  const rounded = Math.round(thousands * 10) / 10;
  return `$${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}k`;
}
