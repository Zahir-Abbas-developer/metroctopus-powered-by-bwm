/**
 * What a member is allowed to know about their own checks.
 *
 * This is the single gate for the feature's central secrecy rule: a member must
 * have **no way** to learn when a future check will fire. Not from an API
 * response, not from a page prop, not from a React state blob in the HTML.
 *
 * Every member-facing payload is built through `visibleCheck` here rather than
 * by spreading a Prisma row, so adding a field to the model can never
 * accidentally leak `scheduledAt`. tests/attendance-visibility.test.ts asserts
 * that property directly.
 *
 * The rule:
 *
 *   SCHEDULED  -> the member learns nothing at all. Not the time, not that one
 *                 exists, not how many are left.
 *   ACTIVE     -> the member sees it, because it is on screen demanding a
 *                 response, and needs the window end for the countdown.
 *   PASSED,
 *   MISSED,
 *   CANCELLED  -> already resolved, so the times are history and safe to show.
 */

export type CheckStatus = "SCHEDULED" | "ACTIVE" | "PASSED" | "MISSED" | "CANCELLED";

export type StoredCheck = {
  id: string;
  scheduledAt: Date;
  windowEndsAt: Date;
  respondedAt: Date | null;
  status: string;
};

/** A check as a member may see it. Note there is no optional `scheduledAt`. */
export type VisibleCheck = {
  id: string;
  status: Exclude<CheckStatus, "SCHEDULED">;
  scheduledAt: string;
  windowEndsAt: string;
  respondedAt: string | null;
  /** Seconds from trigger to response — how quickly they answered. */
  responseSeconds: number | null;
};

export function isResolved(status: string): boolean {
  return status === "PASSED" || status === "MISSED" || status === "CANCELLED";
}

/**
 * Converts a stored check for member consumption, or null when the member is
 * not entitled to know it exists.
 */
export function visibleCheck(check: StoredCheck): VisibleCheck | null {
  if (check.status === "SCHEDULED") return null;

  return {
    id: check.id,
    status: check.status as Exclude<CheckStatus, "SCHEDULED">,
    scheduledAt: check.scheduledAt.toISOString(),
    windowEndsAt: check.windowEndsAt.toISOString(),
    respondedAt: check.respondedAt?.toISOString() ?? null,
    responseSeconds: check.respondedAt
      ? Math.max(
          0,
          Math.round(
            (check.respondedAt.getTime() - check.scheduledAt.getTime()) / 1000,
          ),
        )
      : null,
  };
}

/** The visible subset of a day's checks, in order. */
export function visibleChecks(checks: readonly StoredCheck[]): VisibleCheck[] {
  return checks
    .map(visibleCheck)
    .filter((check): check is VisibleCheck => check !== null)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

/**
 * Counts a member may see: how many have resolved and how they went.
 *
 * Deliberately does not expose how many are still scheduled. "1 of 3 done"
 * would tell a member two more are coming; "2 passed so far" tells them only
 * what has already happened.
 */
export function visibleTally(checks: readonly StoredCheck[]) {
  const resolved = checks.filter((check) => isResolved(check.status));

  return {
    passed: resolved.filter((check) => check.status === "PASSED").length,
    missed: resolved.filter((check) => check.status === "MISSED").length,
    cancelled: resolved.filter((check) => check.status === "CANCELLED").length,
    resolved: resolved.length,
  };
}

/**
 * The admin view.
 *
 * The owner sees progress — "2 passed, 1 active, 1 still to come" — but still
 * not the scheduled times. Nothing in the product needs them, and a shared
 * screen or a screenshot would otherwise hand a member the day's answers.
 */
export function adminTally(checks: readonly StoredCheck[]) {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === "PASSED").length,
    missed: checks.filter((check) => check.status === "MISSED").length,
    active: checks.filter((check) => check.status === "ACTIVE").length,
    pending: checks.filter((check) => check.status === "SCHEDULED").length,
    cancelled: checks.filter((check) => check.status === "CANCELLED").length,
  };
}
