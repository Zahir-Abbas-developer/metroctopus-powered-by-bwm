import type { BadgeTone } from "@/components/ui/Badge";

/**
 * Single source of truth for the string unions stored in the database.
 *
 * SQLite has no native enum type, so these live in code rather than in the
 * Prisma schema. Keeping them here means the same constants validate API
 * input, type the Prisma reads, and drive the UI — and swapping SQLite for
 * Postgres later requires no change to any of it.
 */

export const ROLES = ["ADMIN", "SUPPORT_ADMIN", "MEMBER"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: "Owner",
  SUPPORT_ADMIN: "Support",
  MEMBER: "Team member",
};

/**
 * Roles carrying full administrative capability.
 *
 * SUPPORT_ADMIN is the system maintainer. It is deliberately identical to
 * ADMIN in what it may do, and differs only in what the UI calls it, so the
 * maintainer stays distinguishable from the business owner in audit logs and
 * user lists.
 *
 * Every authority check must go through `hasAdminPower` rather than comparing
 * against "ADMIN" directly. A stray `role === "ADMIN"` silently locks the
 * maintainer out of the thing it guards, and does so quietly enough that
 * nobody finds out until they need it.
 */
export const ADMIN_ROLES: readonly Role[] = ["ADMIN", "SUPPORT_ADMIN"];

/**
 * A person's role *inside* one department. Distinct from the global Role: a
 * department lead runs that business line, but that grants no admin power
 * anywhere else in the app.
 */
export const DEPT_ROLES = ["LEAD", "MEMBER"] as const;
export type DeptRole = (typeof DEPT_ROLES)[number];

export const DEPT_ROLE_LABEL: Record<DeptRole, string> = {
  LEAD: "Department lead",
  MEMBER: "Member",
};

/**
 * What a department-specific field can be attached to.
 *
 * A department often wants a fact while qualifying a deal that it stops caring
 * about once the deal converts — and vice versa — so a definition names its
 * entity rather than being shared across both.
 */
export const FIELD_ENTITIES = ["LEAD", "CLIENT"] as const;
export type FieldEntity = (typeof FIELD_ENTITIES)[number];

export const FIELD_ENTITY_LABEL: Record<FieldEntity, string> = {
  LEAD: "Lead",
  CLIENT: "Client",
};

/**
 * Field types an admin can choose in Settings.
 *
 * The stored value is always text (see `FieldValue` in the schema); the type
 * decides which input renders, how the string is validated, and how it is
 * parsed back for display. Adding a type here is a code change on purpose —
 * each one needs an input and a parser, which data alone cannot supply.
 */
export const FIELD_TYPES = [
  "TEXT",
  "TEXTAREA",
  "PHONE",
  "EMAIL",
  "NUMBER",
  "CURRENCY",
  "DATE",
  "SELECT",
  "MULTISELECT",
  "CHECKBOX",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  TEXT: "Text",
  TEXTAREA: "Long text",
  PHONE: "Phone",
  EMAIL: "Email",
  NUMBER: "Number",
  CURRENCY: "Currency",
  DATE: "Date",
  SELECT: "Single choice",
  MULTISELECT: "Multiple choice",
  CHECKBOX: "Checkbox",
};

/** The two types whose `options` list is meaningful. */
export const FIELD_TYPES_WITH_OPTIONS: readonly FieldType[] = ["SELECT", "MULTISELECT"];

/**
 * What a pipeline stage means, beyond where it sits in the order.
 *
 * Replaces the old isWon/isLost pair, which could express "won and lost at
 * once" — not a state a deal can be in — and had nowhere to put the stages that
 * come *after* a win. Insurance's "Active Client" and Culture Plus's likewise
 * are not the win itself; they are what the record becomes once it converts.
 */
export const STAGE_KINDS = ["OPEN", "WON", "LOST", "ACTIVE_CLIENT"] as const;
export type StageKind = (typeof STAGE_KINDS)[number];

export const STAGE_KIND_LABEL: Record<StageKind, string> = {
  OPEN: "In progress",
  WON: "Won",
  LOST: "Lost",
  ACTIVE_CLIENT: "Active client",
};

export const STAGE_KIND_TONE: Record<StageKind, BadgeTone> = {
  OPEN: "neutral",
  WON: "success",
  LOST: "danger",
  ACTIVE_CLIENT: "info",
};

/** Kinds that end a deal's time on the board. */
export const TERMINAL_STAGE_KINDS: readonly StageKind[] = ["WON", "LOST", "ACTIVE_CLIENT"];

/** Kinds that mean the deal was won — the lifecycle flip to a client. */
export const WINNING_STAGE_KINDS: readonly StageKind[] = ["WON", "ACTIVE_CLIENT"];

export function isStageKind(value: string): value is StageKind {
  return (STAGE_KINDS as readonly string[]).includes(value);
}

/**
 * What happened on a lead or a client.
 *
 * The first six are logged by a person from the quick-log bar; the last three
 * are written by the app when it changes something worth remembering.
 */
export const ACTIVITY_TYPES = [
  "CALL",
  "EMAIL",
  "MEETING",
  "FOLLOW_UP",
  "NOTE",
  "QUOTE",
  "STATUS_CHANGE",
  "ASSIGNMENT",
  "OTHER",
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_TYPE_LABEL: Record<ActivityType, string> = {
  CALL: "Call",
  EMAIL: "Email",
  MEETING: "Meeting",
  FOLLOW_UP: "Follow-up",
  NOTE: "Note",
  QUOTE: "Quote",
  STATUS_CHANGE: "Stage change",
  ASSIGNMENT: "Assignment",
  OTHER: "Other",
};

/** The types a person may log by hand. The rest are written by the app. */
export const LOGGABLE_ACTIVITY_TYPES: readonly ActivityType[] = [
  "CALL",
  "EMAIL",
  "MEETING",
  "FOLLOW_UP",
  "NOTE",
  "QUOTE",
  "OTHER",
];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
};

export const TASK_PRIORITY_TONE: Record<TaskPriority, BadgeTone> = {
  LOW: "neutral",
  MEDIUM: "info",
  HIGH: "warning",
};

export const TASK_STATUSES = ["OPEN", "DONE"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/**
 * Tones a department may be tagged with.
 *
 * Deliberately the exact BadgeTone union rather than a parallel palette: a
 * department picks an existing tone, so its pill is the same pill used
 * everywhere else and no translation layer can drift. A department cannot
 * introduce a colour the design system does not already have.
 */
export const DEPARTMENT_COLOR_TOKENS = [
  "success",
  "info",
  "warning",
  "danger",
  "neutral",
] as const;
export type DepartmentColorToken = (typeof DEPARTMENT_COLOR_TOKENS)[number];

export const DEPARTMENT_COLOR_LABEL: Record<DepartmentColorToken, string> = {
  success: "Green",
  info: "Blue",
  warning: "Amber",
  danger: "Red",
  neutral: "Neutral",
};

export function hasAdminPower(role: Role | string): boolean {
  return role === "ADMIN" || role === "SUPPORT_ADMIN";
}

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
 * `@bwm.local` suffix, that collapsed the whole team onto one or two
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
  return hasAdminPower(role) ? ADMIN_TRANSITIONS[from] : MEMBER_TRANSITIONS[from];
}

export function canTransition(
  role: Role,
  from: MilestoneStatus,
  to: MilestoneStatus,
): boolean {
  return allowedTransitions(role, from).includes(to);
}

/**
 * How `authorize` in lib/auth.ts tells the login form a sign-in was throttled
 * rather than wrong, with the seconds to wait appended after the colon.
 *
 * It lives here rather than beside the auth options because the login form is a
 * client component: importing lib/auth.ts to read one string would pull Prisma
 * and bcrypt into the browser bundle.
 */
export const THROTTLED_ERROR = "RateLimited";
