/**
 * The permission matrix from the Production Doctrine, as code.
 *
 * This module is the single definition of who may see what. It is pure — no
 * Prisma, no session, no clock — so the matrix can be tested exhaustively
 * rather than sampled through the UI, and so a rule can never quietly depend
 * on the request that happened to be in flight.
 *
 * Two ideas hold it together.
 *
 * **Stripping happens before data leaves the server.** Hiding a field in a
 * component is not enforcement: the value still travelled, and it sits in the
 * RSC payload or the JSON body for anyone who opens the network tab. Callers
 * pass a row through the relevant `visible*` function and serialise the result;
 * they do not pass the row and hide it later.
 *
 * **Operational numbers are not agency money.** Ad spend, revenue and ROAS
 * belong to the people doing the work — you cannot run a campaign you are not
 * allowed to measure. What the client pays us, what we bill, what the pipeline
 * is worth and what a bonus comes to is the owner's business. The matrix is
 * that one distinction applied consistently.
 */

export type ViewerRole = "ADMIN" | "SERVICE_LEAD" | "MEMBER";

export type Viewer = {
  id: string;
  /** The database role. SERVICE_LEAD is a MEMBER who leads at least one line. */
  role: ViewerRole;
  /** Service ids this person leads. Empty for a plain member. */
  leadServiceIds: readonly string[];
  /** Carries the pipeline. Gates deal values, and only their own. */
  isBusinessDev: boolean;
  /** Clients this person has work assigned on. Scopes briefs and ad KPIs. */
  assignedClientIds: readonly string[];
  /** Members currently carrying work in this person's service lines. */
  podMemberIds: readonly string[];
};

export const isOwner = (viewer: Viewer): boolean => viewer.role === "ADMIN";

/* ------------------------------------------------------------- predicates -- */

/**
 * Agency money: what clients pay us, what we have collected, what the pipeline
 * is worth in aggregate, what bonuses come to. Owner only, without exception —
 * a service lead's extra authority is over work, not over the books.
 */
export const canSeeAgencyMoney = (viewer: Viewer): boolean => isOwner(viewer);

/** A client's phone number. Owner only. */
export const canSeeClientPhone = (viewer: Viewer): boolean => isOwner(viewer);

/** A client's retainer value. Owner only. */
export const canSeeRetainer = (viewer: Viewer): boolean => isOwner(viewer);

/** Settings, the audit log, the error log, backups. Owner only. */
export const canSeeAdminTooling = (viewer: Viewer): boolean => isOwner(viewer);

/**
 * Deal values on a lead.
 *
 * The owner sees every deal. A business developer sees the deals they own —
 * their own pipeline is the thing they are measured on, so withholding it
 * would make their targets unreadable. Everyone else, service leads included,
 * sees the lead without the money.
 */
export function canSeeDealValue(viewer: Viewer, lead: { ownerId: string | null }): boolean {
  if (isOwner(viewer)) return true;
  if (!viewer.isBusinessDev) return false;
  return lead.ownerId === viewer.id;
}

/** Aggregate pipeline figures — open value, win rate, average deal size. */
export const canSeePipelineTotals = (viewer: Viewer): boolean => isOwner(viewer);

/**
 * A client's brief and the services they bought.
 *
 * Wider than the money rules on purpose: someone cannot deliver work they are
 * not allowed to read the requirements for. Leads see every client because
 * their approval authority spans a service line rather than a client list.
 */
export function canSeeClientBrief(viewer: Viewer, clientId: string): boolean {
  if (isOwner(viewer) || viewer.role === "SERVICE_LEAD") return true;
  return viewer.assignedClientIds.includes(clientId);
}

/**
 * Ad performance — spend, revenue, ROAS.
 *
 * Operational, so it follows the work: a lead sees the clients their service
 * lines touch, a member sees the clients they are assigned to.
 */
export function canSeeClientKpis(
  viewer: Viewer,
  client: { id: string; serviceIds?: readonly string[] },
): boolean {
  if (isOwner(viewer)) return true;
  if (viewer.role === "SERVICE_LEAD") {
    const services = client.serviceIds ?? [];
    if (services.some((id) => viewer.leadServiceIds.includes(id))) return true;
  }
  return viewer.assignedClientIds.includes(client.id);
}

/**
 * Another person's score, on-time rate or attendance.
 *
 * A member sees themselves and nobody else. A lead sees their pod — the people
 * carrying work in their lines — because they answer for that work. Everyone
 * can always see themselves.
 */
export function canSeeMemberNumbers(viewer: Viewer, targetUserId: string): boolean {
  if (isOwner(viewer)) return true;
  if (targetUserId === viewer.id) return true;
  if (viewer.role === "SERVICE_LEAD") return viewer.podMemberIds.includes(targetUserId);
  return false;
}

/**
 * What a bonus is worth.
 *
 * A member sees their own streak — whether they are on track is the part that
 * changes behaviour — but not the amount, and never anyone else's. Amounts are
 * payroll, and payroll is the owner's.
 */
export const canSeeIncentiveAmounts = (viewer: Viewer): boolean => isOwner(viewer);

export function canSeeOwnStreak(viewer: Viewer, targetUserId: string): boolean {
  return isOwner(viewer) || targetUserId === viewer.id;
}

/* ------------------------------------------------------------ serialisers -- */

export type ClientRecord = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone?: string | null;
  industry?: string | null;
  country?: string | null;
  monthlyBudget?: number | null;
  [key: string]: unknown;
};

/**
 * A client, with anything the viewer may not have removed rather than nulled.
 *
 * Deleting the key matters: `monthlyBudget: null` still tells a reader the
 * field exists and invites a component to render "—" where a number belongs,
 * and it makes a leak test unable to distinguish "withheld" from "genuinely
 * empty".
 */
export function visibleClient<T extends ClientRecord>(
  viewer: Viewer,
  client: T,
): Partial<T> {
  const result: Partial<T> = { ...client };
  if (!canSeeClientPhone(viewer)) delete result.phone;
  if (!canSeeRetainer(viewer)) delete result.monthlyBudget;
  return result;
}

export type LeadRecord = {
  id: string;
  ownerId?: string | null;
  estimatedMonthlyValue?: number | null;
  [key: string]: unknown;
};

/** A lead, with the deal value removed unless this viewer owns it. */
export function visibleLead<T extends LeadRecord>(viewer: Viewer, lead: T): Partial<T> {
  const result: Partial<T> = { ...lead };
  if (!canSeeDealValue(viewer, { ownerId: lead.ownerId ?? null })) {
    delete result.estimatedMonthlyValue;
  }
  return result;
}

/**
 * Pipeline aggregates.
 *
 * Returns null for anyone but the owner rather than a zeroed object. A stage
 * board reading "£0 open" is a statement about the business that happens to be
 * false; absent is honest, and the caller renders the counts instead.
 */
export function visiblePipelineTotals<T>(viewer: Viewer, totals: T): T | null {
  return canSeePipelineTotals(viewer) ? totals : null;
}

/** Strips money from the per-stage breakdown, keeping the counts. */
export function visibleStageBreakdown<T extends { stage: string; count: number; value?: number }>(
  viewer: Viewer,
  stages: readonly T[],
): Array<Omit<T, "value"> & { value?: number }> {
  if (canSeePipelineTotals(viewer)) return [...stages];
  return stages.map(({ value: _value, ...rest }) => rest);
}
