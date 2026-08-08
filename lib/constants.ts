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
 * Delivery specialisms across the agency's five service lines. Offered as
 * suggestions in the team form — the field stays free text so the owner can
 * hire into a role nobody anticipated.
 */
export const JOB_TITLES = [
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
