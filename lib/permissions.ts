/**
 * Who may act on what.
 *
 * Pure — no Prisma, no clock, no session. Every input is passed explicitly so
 * the rules can be tested exhaustively, which matters more here than anywhere
 * else in the codebase: this is the file that decides whether somebody can
 * approve their own work.
 *
 * ## The model
 *
 * **ADMIN** — the owner, and any backup owner. Can do anything, anywhere.
 *
 * **Service Lead** — a member who leads one or more service lines. Inside
 * those services they carry the owner's approval authority: they can approve
 * and reject submitted work, excuse availability checks, rule on outage
 * reports and disputes, and see their pod's numbers.
 *
 * **MEMBER** — their own work, and nothing else.
 *
 * ## The two rules that make delegation safe
 *
 * 1. **A lead can never act on themselves.** Not their milestones, not their
 *    attendance, not their disputes. Delegation that let someone sign off
 *    their own work would make the score self-reported, which is exactly what
 *    the approval model has refused since Phase 3. Every one of these
 *    functions checks it, and it is not overridable by configuration.
 *
 * 2. **A lead's authority stops at their service boundary.** Leading Google
 *    Ads confers nothing over a Shopify build.
 *
 * The owner can override any lead decision. That is deliberate and it is
 * logged — see lib/audit.ts.
 */

export type Role = "ADMIN" | "MEMBER";

export type Actor = {
  id: string;
  role: Role;
  /** ServiceCatalog ids this person leads. Empty for most members. */
  leadServiceIds: readonly string[];
};

export type Authority = "ADMIN" | "LEAD" | "NONE";

export type Decision = {
  allowed: boolean;
  /** How the actor is acting, for the audit tag and the UI label. */
  as: Authority;
  /** Why not, in language that can be shown to the person. */
  reason?: string;
};

const DENIED_SELF: Decision = {
  allowed: false,
  as: "NONE",
  reason: "You can't decide on your own work — this one goes to the owner.",
};

const DENIED_SCOPE: Decision = {
  allowed: false,
  as: "NONE",
  reason: "That's outside the service lines you lead.",
};

const DENIED_ROLE: Decision = {
  allowed: false,
  as: "NONE",
  reason: "Only the agency owner or the service lead can do that.",
};

export function isAdmin(actor: Actor): boolean {
  return actor.role === "ADMIN";
}

export function leadsAnything(actor: Actor): boolean {
  return actor.leadServiceIds.length > 0;
}

export function leadsService(actor: Actor, serviceId: string | null): boolean {
  return serviceId !== null && actor.leadServiceIds.includes(serviceId);
}

/**
 * Approving, rejecting or otherwise deciding on a milestone.
 *
 * `serviceId` is the milestone's *module's* service. A module with no service —
 * the hand-made ones — is admin-only, because there is no service line to
 * confer authority.
 */
export function canDecideMilestone(
  actor: Actor,
  milestone: { assigneeId: string | null; serviceId: string | null },
): Decision {
  if (isAdmin(actor)) return { allowed: true, as: "ADMIN" };

  // Checked before scope, so the message a lead sees on their own work is the
  // useful one rather than "outside your service lines".
  if (milestone.assigneeId === actor.id) return DENIED_SELF;

  if (leadsService(actor, milestone.serviceId)) return { allowed: true, as: "LEAD" };

  return leadsAnything(actor) ? DENIED_SCOPE : DENIED_ROLE;
}

/**
 * Acting on a member's attendance — excusing a check, ruling on an outage.
 *
 * A lead's reach here is their **pod**: the members currently carrying work in
 * their service lines. Attendance isn't attached to a service, so the pod is
 * the only honest way to draw the boundary, and it is computed from live
 * assignments rather than stored — see lib/permissions-service.ts.
 */
export function canDecideAttendance(
  actor: Actor,
  subject: { userId: string; inPod: boolean },
): Decision {
  if (isAdmin(actor)) return { allowed: true, as: "ADMIN" };
  if (subject.userId === actor.id) return DENIED_SELF;
  if (subject.inPod && leadsAnything(actor)) return { allowed: true, as: "LEAD" };
  return leadsAnything(actor) ? DENIED_SCOPE : DENIED_ROLE;
}

/**
 * Ruling on a dispute.
 *
 * Same shape as attendance, with one addition worth stating: a lead cannot
 * rule on a dispute about an event *they themselves created*. Otherwise a lead
 * who charged a rejection would be the judge of their own charge, which is the
 * conflict the self-rule exists to prevent, one step removed.
 */
export function canResolveDispute(
  actor: Actor,
  dispute: { subjectId: string; inPod: boolean; eventAuthorId: string | null },
): Decision {
  if (isAdmin(actor)) return { allowed: true, as: "ADMIN" };
  if (dispute.subjectId === actor.id) return DENIED_SELF;

  if (dispute.eventAuthorId === actor.id) {
    return {
      allowed: false,
      as: "NONE",
      reason: "You raised this charge, so someone else has to rule on it.",
    };
  }

  if (dispute.inPod && leadsAnything(actor)) return { allowed: true, as: "LEAD" };
  return leadsAnything(actor) ? DENIED_SCOPE : DENIED_ROLE;
}

/** Seeing a pod's performance dashboards. */
export function canViewPodMetrics(actor: Actor, subjectId: string, inPod: boolean): Decision {
  if (isAdmin(actor)) return { allowed: true, as: "ADMIN" };
  // Your own numbers are always yours.
  if (subjectId === actor.id) return { allowed: true, as: "NONE" };
  if (inPod && leadsAnything(actor)) return { allowed: true, as: "LEAD" };
  return DENIED_ROLE;
}

// ---------------------------------------------------------------------------
// Review routing
// ---------------------------------------------------------------------------

export type ReviewRoute = {
  /** Who should look at this first. Null when only the owner can. */
  leadUserId: string | null;
  /** True once it has waited long enough that the owner is pulled in too. */
  escalated: boolean;
  /** Who can act on it right now. */
  reviewerIds: readonly string[];
};

/**
 * Where a submitted milestone goes.
 *
 * To its service lead first — unless the lead *is* the assignee, in which case
 * it goes straight to the owner rather than sitting in a queue nobody may
 * legitimately clear.
 *
 * After `escalationHours` the owner is added rather than the lead being
 * removed. Delegation must not become a place work goes to die, but taking the
 * lead off it would also punish them for a busy Tuesday.
 */
export function routeReview(options: {
  assigneeId: string | null;
  serviceId: string | null;
  /** Lead ids for the milestone's service, in no particular order. */
  serviceLeadIds: readonly string[];
  adminIds: readonly string[];
  waitingHours: number;
  escalationHours: number;
}): ReviewRoute {
  const eligibleLeads = options.serviceLeadIds.filter((id) => id !== options.assigneeId);
  const leadUserId = eligibleLeads[0] ?? null;
  const escalated = leadUserId === null || options.waitingHours >= options.escalationHours;

  return {
    leadUserId,
    escalated,
    reviewerIds: escalated
      ? [...new Set([...eligibleLeads, ...options.adminIds])]
      : eligibleLeads,
  };
}
