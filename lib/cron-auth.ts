import "server-only";

import { apiError, requireAdminApi } from "@/lib/api";

/**
 * Who may trigger a scheduled job.
 *
 * Two callers are legitimate: Vercel Cron, which presents `CRON_SECRET` as a
 * bearer token and has no session; and the owner pressing a button in the app.
 * Everything else is refused.
 *
 * The comparison is length-checked and constant-time-ish — a plain `===` on a
 * secret invites a timing oracle, and it costs nothing to avoid.
 */
export async function authorizeCron(
  request: Request,
): Promise<{ ok: true; via: "secret" | "session" } | { ok: false; response: Response }> {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";

  if (secret && secret.length > 0 && header.startsWith("Bearer ")) {
    if (safeEqual(header.slice("Bearer ".length), secret)) {
      return { ok: true, via: "secret" };
    }
    // A wrong bearer token is a failed machine call, not a browser visit —
    // don't fall through to the session check and answer with a redirect.
    return { ok: false, response: apiError("Invalid cron credentials", 401) };
  }

  const { response } = await requireAdminApi();
  if (response) return { ok: false, response };

  return { ok: true, via: "session" };
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
