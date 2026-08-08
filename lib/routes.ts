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
  | "my-performance"
  | "my-reports"
  | "team"
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
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", roles: ["ADMIN", "MEMBER"] },
  { key: "board", label: "Board", href: "/board", roles: ["ADMIN", "MEMBER"] },
  { key: "clients", label: "Clients", href: "/clients", roles: ["ADMIN"] },
  { key: "projects", label: "Projects", href: "/projects", roles: ["ADMIN"] },
  { key: "my-tasks", label: "My tasks", href: "/my-tasks", roles: ["ADMIN", "MEMBER"] },
  {
    key: "my-performance",
    label: "My performance",
    href: "/my-performance",
    roles: ["ADMIN", "MEMBER"],
  },
  {
    key: "my-reports",
    label: "My reports",
    href: "/my-reports",
    roles: ["ADMIN", "MEMBER"],
  },
  { key: "team", label: "Team", href: "/team", roles: ["ADMIN"] },
  {
    key: "reports",
    label: "Reports",
    href: "/reports",
    roles: ["ADMIN"],
    // Members open their own report at /reports/<id>; the page checks that it
    // belongs to them.
    scope: "exact",
  },
];

const ADMIN_ONLY = NAV_ITEMS.filter(
  (item) => item.roles.length === 1 && item.roles[0] === "ADMIN",
);

/** Route prefixes only an ADMIN may open, subtree included. */
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

export function navItemsForRole(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

/** Where a user lands after signing in. */
export const DEFAULT_LANDING = "/dashboard";
export const LOGIN_ROUTE = "/login";
