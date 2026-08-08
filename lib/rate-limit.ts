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

/** Sign-in attempts: 8 per 10 minutes, per IP and per account. */
export const LOGIN_LIMIT = 8;
export const LOGIN_WINDOW_MS = 10 * 60 * 1000;

/**
 * Best-effort client IP behind a proxy.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it,
 * which Vercel does. Behind anything else, treat this as a hint.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip") ?? "unknown";
}
