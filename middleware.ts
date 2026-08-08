import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

import { DEFAULT_LANDING, LOGIN_ROUTE, isAdminRoute } from "@/lib/routes";

/**
 * Two gates:
 *   1. No token -> NextAuth redirects to /login (via the `authorized` callback).
 *   2. Token without the ADMIN role -> bounced off admin-only routes.
 */
export default withAuth(
  function middleware(req) {
    const { token } = req.nextauth;

    if (isAdminRoute(req.nextUrl.pathname) && token?.role !== "ADMIN") {
      const url = req.nextUrl.clone();
      url.pathname = DEFAULT_LANDING;
      url.search = "?denied=admin";
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  },
  {
    // The middleware can't import authOptions (it pulls in Prisma and bcrypt,
    // neither of which run on the edge), so the sign-in page is declared again
    // here. Without it, anonymous traffic lands on NextAuth's default
    // /api/auth/signin page instead of ours.
    pages: {
      signIn: LOGIN_ROUTE,
    },
    callbacks: {
      authorized: ({ token }) => Boolean(token),
    },
  },
);

/**
 * Everything except the login page, the auth endpoints and static assets.
 * Listing protected prefixes explicitly (rather than a negative lookahead over
 * the whole app) keeps public routes public by default.
 */
export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/clients/:path*",
    "/projects/:path*",
    "/my-tasks/:path*",
    "/pipeline/:path*",
    "/my-performance/:path*",
    "/my-reports/:path*",
    "/board/:path*",
    "/my-attendance/:path*",
    "/attendance/:path*",
    "/settings/:path*",
    "/team/:path*",
    "/reports/:path*",
    "/api/reports/:path*",
    "/api/notifications/:path*",
    "/api/board/:path*",
    "/api/attachments/:path*",
    "/api/activity/:path*",
    "/api/search/:path*",
    "/api/attendance/:path*",
    "/api/leave/:path*",
    "/api/settings/:path*",
    "/api/team/:path*",
    "/api/clients/:path*",
    "/api/leads/:path*",
    "/api/targets/:path*",
    "/api/capacity/:path*",
    "/api/services/:path*",
    "/api/projects/:path*",
    "/api/modules/:path*",
    "/api/milestones/:path*",
    "/api/score-events/:path*",
    "/api/my-tasks/:path*",
    // /api/cron/* is deliberately absent: the scheduler authenticates with a
    // bearer secret rather than a session, and the handler checks it itself.
  ],
};
