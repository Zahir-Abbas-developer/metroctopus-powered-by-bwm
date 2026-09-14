import "server-only";

/**
 * A small in-process rate limiter, used to slow down credential stuffing.
 *
 * Honest about what it is: the counters live in memory, so each serverless
 * instance keeps its own. That still defeats a naive script hammering one
 * endpoint, but a distributed attacker gets one bucket per instance. Moving to
 * Upstash/Redis is a drop-in replacement for `consume` — the call sites don't
 * change. This is documented in the README rather than left as a surprise.
 *
 * A sliding window rather than a fixed one: fixed windows let an attacker fire
 * a full quota either side of the boundary, doubling the real rate.
 */

type Bucket = { hits: number[] };

const buckets = new Map<string, Bucket>();

/** Drop buckets nothing has touched, so the map can't grow forever. */
let lastSweep = 0;
function sweep(now: number, windowMs: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;

  for (const [key, bucket] of buckets) {
    if (bucket.hits.every((hit) => now - hit > windowMs)) buckets.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the caller may try again; 0 when allowed. */
  retryAfter: number;
};

export function consume(
  key: string,
  limit: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((hit) => now - hit < windowMs);

  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0];
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);

  return { allowed: true, remaining: limit - bucket.hits.length, retryAfter: 0 };
}

/** Clears a key's history — called after a successful sign-in. */
export function reset(key: string): void {
  buckets.delete(key);
}

/**
 * Sign-in attempts per account: 8 per 10 minutes.
 *
 * Per *account*, so the number can stay low — it is one person's own typing,
 * and eight wrong passwords in ten minutes is already generous for somebody who
 * knows theirs.
 */
export const LOGIN_LIMIT = 8;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Sign-in attempts per source address, and why it is so much higher.
 *
 * An address is not a person. A whole office behind one NAT, a team on one
 * office WiFi, a VPN — all of them arrive as a single IP, so a limit sized for
 * one person's typing locks out everybody who shares the connection the moment
 * two colleagues fumble a password. That failure is indistinguishable from a
 * wrong password at the login form, which is exactly how "the credentials
 * stopped working" becomes a support ticket nobody can reproduce.
 *
 * The per-account bucket above is the real defence against guessing one
 * person's password. This bucket only exists to stop a script walking the
 * roster from one machine, which needs far more than eight tries to be worth
 * anything — so it is set where a script trips it and a shared office does not.
 */
export const LOGIN_IP_LIMIT = 60;

/**
 * Best-effort client IP behind a proxy, or null when there isn't one.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it,
 * which Vercel does. Behind anything else, treat this as a hint.
 *
 * Null rather than the old `"unknown"` string, and the distinction is the whole
 * point: a literal `"unknown"` is a perfectly good map key, so every request
 * that arrived without a proxy header — which is every request in local
 * development, in Docker behind a misconfigured nginx, and on any host that
 * does not set these — shared one bucket. Eight failed sign-ins by anybody, and
 * the entire app refused everyone for ten minutes while telling each of them
 * their password was wrong. A caller that cannot identify the source must skip
 * the per-source limit rather than pretend every visitor is the same one.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]!.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  return real || null;
}
