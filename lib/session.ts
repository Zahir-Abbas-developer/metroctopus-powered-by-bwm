import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "@/lib/auth";
import { DEFAULT_LANDING, LOGIN_ROUTE } from "@/lib/routes";
import { hasAdminPower } from "@/lib/constants";

/** The signed-in user, or null. Safe to call anywhere on the server. */
export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  return session?.user ?? null;
}

/**
 * Server-component guard. Middleware already blocks unauthenticated traffic;
 * this is the second line of defence so a page can never render with a null
 * user just because a matcher was mis-typed.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect(LOGIN_ROUTE);
  return user;
}

/** Same, plus an ADMIN role check. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!hasAdminPower(user.role)) redirect(DEFAULT_LANDING);
  return user;
}
