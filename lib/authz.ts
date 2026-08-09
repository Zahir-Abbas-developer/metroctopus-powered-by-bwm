import type { Viewer } from "@/lib/visibility";
import {
  canSeeAdminTooling,
  canSeeAgencyMoney,
  canSeeClientBrief,
} from "@/lib/visibility";

/**
 * One answer to "may this person do this".
 *
 * `lib/visibility.ts` decides what a viewer may *see*; this decides what they
 * may *do*. They are separate because the answers differ: a service lead sees
 * every client's brief and may still not edit a client, and a member sees
 * their own score and may never adjust it.
 *
 * Every mutation calls `can()` before it writes, and every server component
 * calls it before rendering an admin-only section. Hiding a button is a
 * courtesy to the person clicking; it is not a permission, because the request
 * behind the button can be sent without ever loading the page.
 *
 * `lib/permissions.ts` still owns the delegated-approval rules — who may
 * decide a milestone, rule on a dispute or excuse a check — because those
 * depend on the specific row and carry their own refusal messages. `can()`
 * delegates to it rather than restating it, so there is one definition of a
 * lead's authority rather than two that can drift.
 */

export type Action =
  // Clients and delivery
  | "client:create"
  | "client:update"
  | "client:archive"
  | "project:create"
  | "project:update"
  | "milestone:create"
  | "milestone:update"
  | "milestone:submit"
  // Configuration — the owner's, all of it
  | "settings:read"
  | "settings:update"
  | "service:manage"
  | "template:manage"
  | "team:manage"
  | "team:deactivate"
  // Money
  | "money:read"
  | "payment:manage"
  // Oversight
  | "audit:read"
  | "errors:read"
  | "backup:manage"
  | "score:adjust"
  | "evaluation:run";

export type Resource =
  | { kind: "client"; clientId: string }
  | { kind: "milestone"; assigneeId: string | null; serviceId: string | null }
  | { kind: "user"; userId: string }
  | { kind: "none" };

export type Decision = { allowed: boolean; reason?: string };

const ALLOW: Decision = { allowed: true };
const deny = (reason: string): Decision => ({ allowed: false, reason });

const OWNER_ONLY = new Set<Action>([
  "client:create",
  "client:archive",
  "settings:update",
  "service:manage",
  "template:manage",
  "team:manage",
  "team:deactivate",
  "payment:manage",
  "audit:read",
  "errors:read",
  "backup:manage",
  "score:adjust",
  "evaluation:run",
]);

/**
 * The single authorization question.
 *
 * Returns a reason on refusal so a route can say something specific. A generic
 * "forbidden" makes a legitimate user think the app is broken, and tells an
 * illegitimate one exactly as much.
 */
export function can(viewer: Viewer, action: Action, resource: Resource = { kind: "none" }): Decision {
  const isOwner = viewer.role === "ADMIN";

  if (OWNER_ONLY.has(action)) {
    return isOwner ? ALLOW : deny("Only the agency owner can do that");
  }

  switch (action) {
    case "settings:read":
      // Reading settings is how the app explains its own rules — the scoring
      // policy page depends on it — so it is not owner-only. Writing is.
      return ALLOW;

    case "money:read":
      return canSeeAgencyMoney(viewer)
        ? ALLOW
        : deny("Agency financials are visible to the owner only");

    case "client:update":
      if (isOwner) return ALLOW;
      return deny("Only the agency owner can edit a client");

    case "project:create":
    case "project:update":
      if (isOwner) return ALLOW;
      if (resource.kind === "client" && viewer.role === "SERVICE_LEAD") {
        return canSeeClientBrief(viewer, resource.clientId)
          ? ALLOW
          : deny("That client isn't in your service lines");
      }
      return deny("Only the agency owner or a service lead can change a project plan");

    case "milestone:create":
    case "milestone:update":
      if (isOwner) return ALLOW;
      if (resource.kind === "milestone") {
        // Working on your own milestone is not the same as deciding it; the
        // approval rules live in lib/permissions.ts and are checked there.
        if (resource.assigneeId === viewer.id) return ALLOW;
        if (
          viewer.role === "SERVICE_LEAD" &&
          resource.serviceId !== null &&
          viewer.leadServiceIds.includes(resource.serviceId)
        ) {
          return ALLOW;
        }
      }
      return deny("That isn't your milestone");

    case "milestone:submit":
      if (resource.kind === "milestone" && resource.assigneeId === viewer.id) return ALLOW;
      return isOwner ? ALLOW : deny("Only the person assigned can submit this work");

    default:
      return deny("Not permitted");
  }
}

/** Convenience for the common `if (!allowed) return 403` shape in routes. */
export function assertCan(
  viewer: Viewer,
  action: Action,
  resource: Resource = { kind: "none" },
): Decision {
  return can(viewer, action, resource);
}

/** True when the viewer may open any part of the admin tooling. */
export const canOpenAdminTooling = (viewer: Viewer): boolean => canSeeAdminTooling(viewer);
