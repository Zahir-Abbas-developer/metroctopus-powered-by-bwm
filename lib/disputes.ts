import { prisma } from "@/lib/prisma";
import { agencyYearMonth } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { sendPush } from "@/lib/reach";
import { getSettings } from "@/lib/settings";
import { recordAudit } from "@/lib/audit";
import { disputeStats } from "@/lib/incentives";
import { SCORE_EVENT_LABEL, type ScoreEventType } from "@/lib/scoring";

/**
 * Formal disputes: arguments about points leave chat for good.
 *
 * The mechanism matters less than the guarantee behind it. Whichever way a
 * dispute goes, **the original event survives** — a reversal writes a
 * compensating MANUAL_ADJUST beside it, exactly as excusals have since Phase 7.
 * A ledger that can be edited to make an argument go away is not evidence, and
 * a process built on one is not a process.
 *
 * Three deliberate constraints:
 *
 *   **A window.** Seven days from the event, configurable. Beyond that the
 *   month is closed, reports quoting it are frozen, and re-litigating it moves
 *   numbers people have already acted on.
 *
 *   **One dispute per event.** The unique index says so. Re-filing after a
 *   ruling is an appeal, and an appeal is a conversation, not a form.
 *
 *   **A written response either way.** Upholding without saying why is exactly
 *   the silence this replaces.
 */

export type FileResult =
  | { ok: true; id: string }
  | { ok: false; reason: string; field?: string };

export async function fileDispute(options: {
  scoreEventId: string;
  userId: string;
  reason: string;
  now?: Date;
}): Promise<FileResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  const event = await prisma.scoreEvent.findUnique({
    where: { id: options.scoreEventId },
    include: { dispute: true, user: { select: { name: true } } },
  });

  if (!event) return { ok: false, reason: "That score event no longer exists." };
  if (event.userId !== options.userId) {
    return { ok: false, reason: "You can only dispute events on your own record." };
  }
  if (event.dispute) {
    return { ok: false, reason: "You've already disputed this one." };
  }
  if (event.points >= 0) {
    return {
      ok: false,
      reason: "That event didn't cost you anything — there's nothing to dispute.",
    };
  }

  const ageDays = (now.getTime() - event.createdAt.getTime()) / 86_400_000;
  if (ageDays > settings.disputeWindowDays) {
    return {
      ok: false,
      reason: `Disputes close after ${settings.disputeWindowDays} days. Talk to the owner directly about this one.`,
    };
  }

  const dispute = await prisma.dispute.create({
    data: {
      scoreEventId: event.id,
      userId: options.userId,
      reason: options.reason,
    },
  });

  await recordAudit({
    actorId: options.userId,
    action: "DISPUTE_FILED",
    entityType: "ScoreEvent",
    entityId: event.id,
    summary: `Disputed ${SCORE_EVENT_LABEL[event.type as ScoreEventType]?.toLowerCase() ?? event.type} (${event.points})`,
    after: { reason: options.reason },
  });

  // Told to the owner and to whoever raised the charge, if that wasn't the
  // system — they are the person who can explain it fastest.
  const recipients = new Set(
    (await admins()).map((admin) => admin.id).concat(event.createdById ? [event.createdById] : []),
  );
  recipients.delete(options.userId);

  for (const userId of recipients) {
    await notify({
      userId,
      type: "REVIEW_OVERDUE",
      title: "Score dispute filed",
      body: `${event.user.name} is challenging ${event.points} points: ${options.reason.slice(0, 120)}`,
      href: "/disputes",
      dedupeKey: `dispute:${dispute.id}:${userId}`,
    });
  }

  return { ok: true, id: dispute.id };
}

export type ResolveResult =
  | { ok: true; reversed: boolean; adjustmentId: string | null }
  | { ok: false; reason: string };

/**
 * The ruling.
 *
 * REVERSE writes a compensating MANUAL_ADJUST of the exact opposite value,
 * charged to the same cycle as the original so reversing a March charge in
 * April cannot silently credit April.
 *
 * UPHOLD changes nothing except the record — which is the point. The member
 * gets a written answer, and the fact that they asked is permanent.
 */
export async function resolveDispute(options: {
  disputeId: string;
  resolverId: string;
  uphold: boolean;
  responseNote: string;
  asLead: boolean;
  now?: Date;
}): Promise<ResolveResult> {
  const now = options.now ?? new Date();

  const dispute = await prisma.dispute.findUnique({
    where: { id: options.disputeId },
    include: {
      scoreEvent: true,
      user: { select: { id: true, name: true } },
    },
  });

  if (!dispute) return { ok: false, reason: "That dispute no longer exists." };
  if (dispute.status !== "OPEN") return { ok: false, reason: "That dispute is already decided." };

  let adjustmentId: string | null = null;

  if (!options.uphold) {
    const original = dispute.scoreEvent;
    const cycle = agencyYearMonth(original.createdAt);

    try {
      const reversal = await prisma.scoreEvent.create({
        data: {
          userId: original.userId,
          milestoneId: null,
          type: "MANUAL_ADJUST",
          points: Math.abs(original.points),
          reason: `Dispute upheld: ${options.responseNote}`,
          // Same cycle as the original, so a March charge reversed in April
          // credits March.
          year: cycle.year,
          month: cycle.month,
          dedupeKey: `dispute:${dispute.id}:REVERSAL`,
          createdById: options.resolverId,
        },
      });
      adjustmentId = reversal.id;
    } catch {
      // Already reversed. The unique dedupe key is the guard.
    }
  }

  await prisma.dispute.update({
    where: { id: dispute.id },
    data: {
      status: options.uphold ? "UPHELD" : "REVERSED",
      resolvedById: options.resolverId,
      resolvedAt: now,
      responseNote: options.responseNote,
      resolvedAsLead: options.asLead,
    },
  });

  await recordAudit({
    actorId: options.resolverId,
    action: "DISPUTE_RESOLVED",
    entityType: "Dispute",
    entityId: dispute.id,
    summary: `${options.uphold ? "Upheld the charge" : "Reversed the charge"} against ${dispute.user.name}: ${options.responseNote}`,
    before: { status: "OPEN", points: dispute.scoreEvent.points },
    after: {
      status: options.uphold ? "UPHELD" : "REVERSED",
      compensated: options.uphold ? 0 : Math.abs(dispute.scoreEvent.points),
    },
    asLead: options.asLead,
  });

  await notify({
    userId: dispute.userId,
    type: options.uphold ? "WORK_REJECTED" : "WORK_APPROVED",
    title: options.uphold ? "Your dispute wasn't upheld" : "Your dispute was upheld",
    body: options.responseNote,
    href: "/my-performance",
  });

  await sendPush(dispute.userId, {
    title: options.uphold ? "Dispute decided" : "Dispute upheld — points returned",
    body: options.responseNote.slice(0, 140),
    url: "/my-performance",
    tag: "dispute",
  });

  return { ok: true, reversed: !options.uphold, adjustmentId };
}

/**
 * Chases open disputes past their SLA.
 *
 * Escalating: the reminder goes daily, and once past double the SLA it says so
 * in stronger terms. A member who has waited a week for an answer has learned
 * that the formal process is slower than the chat it replaced.
 */
export async function chaseOpenDisputes(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const cutoff = new Date(now.getTime() - settings.disputeSlaHours * 3_600_000);

  const overdue = await prisma.dispute.findMany({
    where: { status: "OPEN", createdAt: { lt: cutoff } },
    include: { user: { select: { name: true } } },
  });

  if (overdue.length === 0) return 0;

  const today = now.toISOString().slice(0, 10);
  let sent = 0;

  for (const admin of await admins()) {
    for (const dispute of overdue) {
      const hours = Math.round((now.getTime() - dispute.createdAt.getTime()) / 3_600_000);
      const badly = hours >= settings.disputeSlaHours * 2;

      const created = await notify({
        userId: admin.id,
        type: "REVIEW_OVERDUE",
        title: badly ? "Dispute badly overdue" : "Dispute past its SLA",
        body: badly
          ? `${dispute.user.name} has been waiting ${hours}h for an answer. The formal process is now slower than the chat it replaced.`
          : `${dispute.user.name} has been waiting ${hours}h. The SLA is ${settings.disputeSlaHours}h.`,
        href: "/disputes",
        dedupeKey: `dispute-overdue:${dispute.id}:${today}:${admin.id}`,
      });
      if (created) sent += 1;
    }
  }

  return sent;
}

/** This month's dispute picture, with the insight text. */
export async function monthlyDisputeStats(now = new Date()) {
  const cycle = agencyYearMonth(now);
  const from = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  const to = new Date(Date.UTC(cycle.year, cycle.month, 1));

  const disputes = await prisma.dispute.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { status: true },
  });

  return disputeStats({
    filed: disputes.length,
    reversed: disputes.filter((row) => row.status === "REVERSED").length,
    upheld: disputes.filter((row) => row.status === "UPHELD").length,
    open: disputes.filter((row) => row.status === "OPEN").length,
  });
}

async function admins() {
  return prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
}
