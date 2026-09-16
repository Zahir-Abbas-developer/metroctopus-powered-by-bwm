import { prisma } from "@/lib/prisma";

/**
 * The record of who exercised authority.
 *
 * Distinct from `lib/activity.ts`, and the distinction matters. Activity is a
 * milestone's story, written for the team and rendered in a feed: "Tayyaba
 * moved Campaign launch to Submitted". This is written for the person asking
 * "who did that, and what was it before?" — score adjustments, dispute
 * rulings, role changes, settings edits, excusals.
 *
 * Never throws into its caller. An audit write failing must not roll back the
 * decision it was recording; a missing line is recoverable, a half-applied
 * approval is not. Failures go to the server log where they are visible.
 */

export const AUDIT_ACTIONS = [
  "MILESTONE_APPROVED",
  "MILESTONE_REJECTED",
  "SCORE_ADJUSTED",
  "DISPUTE_FILED",
  "DISPUTE_RESOLVED",
  "CHECK_EXCUSED",
  "OUTAGE_REVIEWED",
  "BLOCK_VETOED",
  "ROLE_CHANGED",
  "LEAD_ASSIGNED",
  "SETTINGS_EDITED",
  "INCENTIVE_ACTIONED",
  "LEAVE_REVIEWED",
  "DEPARTMENT_CREATED",
  "DEPARTMENT_UPDATED",
  "DEPARTMENT_MEMBERS_CHANGED",
  "DEPARTMENT_FIELDS_CHANGED",
  "CLIENT_FIELDS_CHANGED",
  "DEPARTMENT_STAGES_CHANGED",
  "MODULE_TOGGLED",
  "PASSWORD_RESET",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  MILESTONE_APPROVED: "Approved work",
  MILESTONE_REJECTED: "Rejected work",
  SCORE_ADJUSTED: "Adjusted a score",
  DISPUTE_FILED: "Filed a dispute",
  DISPUTE_RESOLVED: "Resolved a dispute",
  CHECK_EXCUSED: "Excused a check",
  OUTAGE_REVIEWED: "Reviewed an outage",
  BLOCK_VETOED: "Overruled a block",
  ROLE_CHANGED: "Changed a role",
  LEAD_ASSIGNED: "Changed service leads",
  SETTINGS_EDITED: "Edited settings",
  INCENTIVE_ACTIONED: "Actioned an incentive",
  LEAVE_REVIEWED: "Reviewed leave",
  DEPARTMENT_CREATED: "Created a department",
  DEPARTMENT_UPDATED: "Edited a department",
  DEPARTMENT_MEMBERS_CHANGED: "Changed department members",
  DEPARTMENT_FIELDS_CHANGED: "Changed department fields",
  CLIENT_FIELDS_CHANGED: "Edited client fields",
  DEPARTMENT_STAGES_CHANGED: "Changed department pipeline",
  MODULE_TOGGLED: "Switched a module on or off",
  PASSWORD_RESET: "Reset a password",
};

export type AuditInput = {
  actorId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  /** Only the fields that changed — a whole-row dump is unreadable at review time. */
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  /** True when the actor was acting as a Service Lead rather than the owner. */
  asLead?: boolean;
};

export async function recordAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        summary: input.summary,
        beforeJson: input.before ? JSON.stringify(input.before) : null,
        afterJson: input.after ? JSON.stringify(input.after) : null,
        asLead: Boolean(input.asLead),
      },
    });
  } catch (error) {
    console.error("audit write failed", input.action, error);
  }
}

/**
 * Only the keys that actually changed.
 *
 * Storing a whole row before and after makes the log technically complete and
 * practically unreadable — the reviewer has to diff two blobs by eye to find
 * the one field that moved.
 */
export function changedFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changedBefore[key] = before[key];
    changedAfter[key] = after[key];
  }

  return Object.keys(changedAfter).length === 0
    ? null
    : { before: changedBefore, after: changedAfter };
}
