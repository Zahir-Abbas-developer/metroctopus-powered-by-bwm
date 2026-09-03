import type { Role } from "@/lib/constants";

/**
 * Route map shared by the middleware (edge runtime) and the sidebar. Keeping
 * it dependency-free — no Prisma, no React — means one definition of "who can
 * see what" instead of a guard and a nav list that can drift apart.
 */

export type NavKey =
  | "dashboard"
  | "board"
  | "clients"
  | "projects"
  | "my-tasks"
  | "pipeline"
  | "my-attendance"
  | "attendance"
  | "my-performance"
  | "my-reports"
  | "disputes"
  | "incentives"
  | "audit"
  | "errors"
  | "scoring"
  | "team"
  | "settings"
  | "reports";

export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  /** Roles allowed to open the route. */
  roles: readonly Role[];
  /**
   * How far the role restriction reaches.
   *
   * "prefix" (the default) locks the whole subtree. "exact" locks only the
   * index — used by /reports, where the listing is the owner's but a member
   * must still be able to open /reports/<id> for a report that belongs to
   * them. The page itself checks ownership.
   */
  scope?: "prefix" | "exact";
  /** Rendered as a visible-but-inert link until the phase that builds it. */
  comingSoon?: boolean;
  /**
   * Reachable and still role-gated, but not shown in the rail.
   *
   * The audit and error logs live under Settings rather than as top-level
   * entries. They stay in this list because it is what grants them admin-only
   * protection — dropping them would make /admin/audit a route nobody guards.
   */
  hidden?: boolean;
};

/**
 * SUPPORT_ADMIN reaches everything ADMIN reaches. Spelling it out per item
 * would mean every future nav entry silently locking the maintainer out, so
 * the two admin roles are written once here.
 */
const ADMINS: readonly Role[] = ["ADMIN", "SUPPORT_ADMIN"];
const EVERYONE: readonly Role[] = ["ADMIN", "SUPPORT_ADMIN", "MEMBER"];

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", roles: EVERYONE },
  { key: "board", label: "Board", href: "/board", roles: EVERYONE },
  { key: "pipeline", label: "Pipeline", href: "/pipeline", roles: EVERYONE },
  { key: "clients", label: "Clients", href: "/clients", roles: ADMINS },
  { key: "projects", label: "Projects", href: "/projects", roles: ADMINS },
  { key: "my-tasks", label: "Tasks", href: "/my-tasks", roles: EVERYONE },
  {
    key: "my-attendance",
    label: "My attendance",
    href: "/my-attendance",
    roles: EVERYONE,
  },
  { key: "attendance", label: "Attendance", href: "/attendance", roles: ADMINS },
  {
    key: "my-performance",
    label: "My performance",
    href: "/my-performance",
    roles: EVERYONE,
  },
  {
    key: "my-reports",
    label: "My reports",
    href: "/my-reports",
    roles: EVERYONE,
  },
  {
    key: "disputes",
    label: "Disputes",
    href: "/disputes",
    roles: EVERYONE,
  },
  { key: "incentives", label: "Incentives", href: "/incentives", roles: ADMINS },
  { key: "team", label: "Team", href: "/team", roles: ADMINS },
  {
    key: "scoring",
    label: "How scoring works",
    href: "/scoring",
    roles: EVERYONE,
  },
  { key: "settings", label: "Settings", href: "/settings", roles: ADMINS },
  { key: "audit", label: "Audit log", href: "/admin/audit", roles: ADMINS, hidden: true },
  { key: "errors", label: "Error log", href: "/admin/errors", roles: ADMINS, hidden: true },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    roles: ADMINS,
    // Members open their own report at /reports/<id>; the page checks that it
    // belongs to them.
    scope: "exact",
  },
];

/**
 * Admin-only means "a MEMBER may not open it" — not "exactly one role is
 * listed". Deriving it from the absence of MEMBER is what lets SUPPORT_ADMIN
 * be added to an item without that item quietly losing its guard.
 */
const ADMIN_ONLY = NAV_ITEMS.filter((item) => !item.roles.includes("MEMBER"));

/** Route prefixes only an admin may open, subtree included. */
export const ADMIN_ROUTE_PREFIXES = ADMIN_ONLY.filter(
  (item) => item.scope !== "exact",
).map((item) => item.href);

/** Routes where only the index itself is restricted. */
export const ADMIN_EXACT_ROUTES = ADMIN_ONLY.filter(
  (item) => item.scope === "exact",
).map((item) => item.href);

export function isAdminRoute(pathname: string): boolean {
  if (ADMIN_EXACT_ROUTES.includes(pathname)) return true;

  return ADMIN_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * The rail's contents for one person.
 *
 * `hiddenKeys` carries the nav entries belonging to a disabled module. They are
 * filtered here rather than in the component so that the rail, and anything
 * else that lists navigation, cannot disagree about what is switched off.
 */
export function navItemsForRole(role: Role, hiddenKeys: readonly NavKey[] = []): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles.includes(role) && !item.hidden && !hiddenKeys.includes(item.key),
  );
}

/** Where a user lands after signing in. */
export const DEFAULT_LANDING = "/dashboard";
export const LOGIN_ROUTE = "/login";
