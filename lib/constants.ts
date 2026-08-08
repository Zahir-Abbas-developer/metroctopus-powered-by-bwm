import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Single source of truth for the string unions stored in the database.
 *
 * SQLite has no native enum type, so these live in code rather than in the
 * Prisma schema. Keeping them here means the same constants validate API
 * input, type the Prisma reads, and drive the UI — and swapping SQLite for
 * Postgres later requires no change to any of it.
 */

export const ROLES = ["ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Owner",
  MEMBER: "Team member",
};

/**
 * Suggestions in the team form — the field stays free text so the owner can
 * hire into a role nobody anticipated.
 *
 * The current team's titles come first, since those are the ones being typed
 * in practice; the generic single-discipline labels follow for future hires.
 */
export const JOB_TITLES = [
  "Founder · Client Acquisition & Scaling",
  "Performance Marketer",
  "Business Developer",
  "Shopify Designer · AI Websites · Product Hunting",
  "Ecommerce Marketplaces · Sourcing · AI SEO",
  "Shopify Developer",
  "Web Developer",
  "Media Buyer",
  "Google Ads Specialist",
  "Meta Ads Specialist",
  "Creative Designer",
  "Creative Strategist",
  "Funnel Manager",
  "Content Writer",
  "Account Manager",
] as const;

/**
 * Avatar chips. Every value is an accent token from the fixed palette, so
 * member avatars can never drift outside the product's identity.
 *
 * Near-black is deliberately excluded: it's the sidebar's own background, and
 * a chip using it vanishes against the dark rail.
 */
export const AVATAR_COLORS = [
  "#1A6B3A", // primary green
  "#1A4FA0", // info blue
  "#C4730A", // amber
  "#C0392B", // red
] as const;

export type AvatarColor = (typeof AVATAR_COLORS)[number];

/**
 * Deterministic colour pick, so a member's chip never changes between renders.
 *
 * FNV-1a with an avalanche fold. A plain `hash * 31` rolling sum puts almost
 * no entropy in the low bits, and since every address here shares the same
 * `@agency.local` suffix, that collapsed the whole team onto one or two
 * colours. The fold mixes the high bits down before the modulo.
 */
export function avatarColorFor(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;

  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length];
}

/** "Ayesha Khan" -> "AK"; falls back to the first character for one-word names. */
export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

export const CLIENT_STATUSES = ["LEAD", "ACTIVE", "PAUSED", "CHURNED"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABEL: Record<ClientStatus, string> = {
  LEAD: "Lead",
  ACTIVE: "Active",
  PAUSED: "Paused",
  CHURNED: "Churned",
};

export const CLIENT_STATUS_TONE: Record<ClientStatus, BadgeTone> = {
  LEAD: "info",
  ACTIVE: "success",
  PAUSED: "warning",
  CHURNED: "danger",
};

/** Suggestions only — the field stays free text. */
export const INDUSTRIES = [
  "Apparel & Fashion",
  "Beauty & Skincare",
  "Health & Supplements",
  "Home & Furniture",
  "Electronics & Gadgets",
  "Jewellery & Accessories",
  "Food & Beverage",
  "Pet Products",
  "Sports & Fitness",
  "Baby & Kids",
] as const;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = [
  "PLANNING",
  "ACTIVE",
  "COMPLETED",
  "OVERDUE_CLOSEOUT",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  PLANNING: "Planning",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  OVERDUE_CLOSEOUT: "Overdue closeout",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  PLANNING: "info",
  ACTIVE: "success",
  COMPLETED: "neutral",
  OVERDUE_CLOSEOUT: "danger",
};

/** Default engagement length. Spec: endDate = startDate + 30 days. */
export const PROJECT_LENGTH_DAYS = 30;

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

export const MILESTONE_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "BLOCKED",
  "SUBMITTED",
  "COMPLETED",
  "MISSED",
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  BLOCKED: "Blocked",
  SUBMITTED: "Submitted",
  COMPLETED: "Completed",
  MISSED: "Missed",
};

export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, BadgeTone> = {
  PENDING: "neutral",
  IN_PROGRESS: "info",
  // Deliberately muted rather than alarming: a block is a paused clock, not a
  // failure, and colouring it like one would discourage declaring it.
  BLOCKED: "neutral",
  SUBMITTED: "warning",
  COMPLETED: "success",
  MISSED: "danger",
};

export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 5;
export const WEIGHT_DEFAULT = 3;

export const WEIGHT_LABEL: Record<number, string> = {
  1: "Minor",
  2: "Low",
  3: "Standard",
  4: "High",
  5: "Critical",
};

/**
 * Transitions each role may perform.
 *
 * A member drives their own work forward but can never mark it COMPLETED —
 * approval belongs to the owner, because completion is what the scoring engine
 * pays out on. Letting members self-approve would make the score self-reported.
 */
export const MEMBER_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED", "PENDING"],
  BLOCKED: [],
  SUBMITTED: [],
  COMPLETED: [],
  MISSED: ["IN_PROGRESS"],
};

export const ADMIN_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  PENDING: ["IN_PROGRESS", "SUBMITTED", "COMPLETED", "MISSED"],
  IN_PROGRESS: ["PENDING", "SUBMITTED", "COMPLETED", "MISSED"],
  BLOCKED: [],
  SUBMITTED: ["COMPLETED", "IN_PROGRESS", "MISSED"],
  COMPLETED: ["IN_PROGRESS"],
  MISSED: ["IN_PROGRESS", "COMPLETED"],
};

/**
 * BLOCKED is deliberately absent from both matrices in every direction.
 *
 * It is not a status you drag a card into: entering it requires a reason and a
 * note, and leaving it has to close the block period and bank the minutes.
 * Both go through /api/milestones/[id]/block, which owns the clock. Routing it
 * through the generic transition endpoint would let a card be dragged out of
 * BLOCKED and silently lose the pause.
 */
export const BLOCK_ENDPOINT_ONLY = true;

export function allowedTransitions(
  role: Role,
  from: MilestoneStatus,
): MilestoneStatus[] {
  return role === "ADMIN" ? ADMIN_TRANSITIONS[from] : MEMBER_TRANSITIONS[from];
}

export function canTransition(
  role: Role,
  from: MilestoneStatus,
  to: MilestoneStatus,
): boolean {
  return allowedTransitions(role, from).includes(to);
}
