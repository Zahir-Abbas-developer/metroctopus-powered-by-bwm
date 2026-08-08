import type { Role } from "@/lib/constants";

/**
 * Route map shared by the middleware (edge runtime) and the sidebar. Keeping
 * it dependency-free — no Prisma, no React — means one definition of "who can
 * see what" instead of a guard and a nav list that can drift apart.
 */

export type NavKey =
  | "dashboard"
  | "clients"
  | "projects"
  | "tasks"
  | "team"
  | "reports";

export type NavItem = {
  key: NavKey;
  label: string;
  href: string;
  /** Roles allowed to open the route. */
  roles: readonly Role[];
  /** Phase 1 renders these as visible-but-inert links. */
  comingSoon?: boolean;
};

export const NAV_ITEMS: readonly NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/dashboard", roles: ["ADMIN", "MEMBER"] },
  { key: "clients", label: "Clients", href: "/clients", roles: ["ADMIN"], comingSoon: true },
  { key: "projects", label: "Projects", href: "/projects", roles: ["ADMIN", "MEMBER"], comingSoon: true },
  { key: "tasks", label: "Tasks", href: "/tasks", roles: ["ADMIN", "MEMBER"], comingSoon: true },
  { key: "team", label: "Team", href: "/team", roles: ["ADMIN"] },
  { key: "reports", label: "Reports", href: "/reports", roles: ["ADMIN", "MEMBER"], comingSoon: true },
];

/** Route prefixes only an ADMIN may open. */
export const ADMIN_ROUTE_PREFIXES = NAV_ITEMS.filter(
  (item) => item.roles.length === 1 && item.roles[0] === "ADMIN",
).map((item) => item.href);

export function isAdminRoute(pathname: string): boolean {
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
