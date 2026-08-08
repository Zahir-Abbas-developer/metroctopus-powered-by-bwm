import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { recordStatusChange } from "@/lib/activity";
import type { MilestoneStatus } from "@/lib/constants";
import {
  BLOCK_REASON_LABEL,
  describeBlocked,
  type BlockReason,
} from "@/lib/fairness-types";

// Re-exported so server callers keep importing from one place.
export * from "@/lib/fairness-types";

/**
 * The blocked clock.
 *
 * A milestone waiting on a client asset, an ad-account approval or another
 * milestone is time its assignee cannot act in, so it does not count against
 * them. Entering BLOCKED opens a `BlockPeriod`; leaving it closes the period
 * and adds its minutes to the milestone's running total, which the scoring
 * engine adds to the deadline.
 *
 * Two properties keep this from being a loophole:
 *
 *   Every block is a record, not a flag. A reason and a written note are
 *   required, the owner is notified the moment one is raised, and the periods
 *   stay on the milestone afterwards.
 *
 *   The owner can veto. A vetoed period is kept — deleting it would erase the
 *   fact that someone tried — but contributes no time to the deadline.
 */

/** Minutes between two instants, floored and never negative. */
function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

/**
 * Blocked minutes including the block currently running.
 *
 * The stored total only advances when a block closes, so anything that shows a
 * live shifted deadline has to add the open period itself.
 */
export function liveBlockedMinutes(
  milestone: { blockedMinutes: number; blockedSince: Date | null },
  now: Date = new Date(),
): number {
  if (!milestone.blockedSince) return milestone.blockedMinutes;
  return milestone.blockedMinutes + minutesBetween(milestone.blockedSince, now);
}

export type BlockResult =
  | { ok: true; blockPeriodId: string }
  | { ok: false; reason: string };

export async function blockMilestone(options: {
  milestoneId: string;
  actorId: string;
  reason: BlockReason;
  note: string;
  blockingMilestoneId?: string | null;
  now?: Date;
}): Promise<BlockResult> {
  const now = options.now ?? new Date();

  const milestone = await prisma.milestone.findUnique({
    where: { id: options.milestoneId },
    include: { assignee: { select: { id: true, name: true } } },
  });
  if (!milestone) return { ok: false, reason: "That milestone no longer exists." };
  if (milestone.status === "BLOCKED") return { ok: false, reason: "It's already blocked." };
  if (milestone.status === "COMPLETED") {
    return { ok: false, reason: "Completed work can't be blocked." };
  }

  if (options.blockingMilestoneId) {
    if (options.blockingMilestoneId === milestone.id) {
      return { ok: false, reason: "A milestone can't wait on itself." };
    }
    const blocker = await prisma.milestone.findUnique({
      where: { id: options.blockingMilestoneId },
      select: { id: true, status: true },
    });
    if (!blocker) return { ok: false, reason: "That blocking milestone doesn't exist." };
    if (blocker.status === "COMPLETED") {
      return { ok: false, reason: "That milestone is already complete — nothing to wait for." };
    }
  }

  const period = await prisma.blockPeriod.create({
    data: {
      milestoneId: milestone.id,
      reason: options.reason,
      note: options.note,
      blockingMilestoneId: options.blockingMilestoneId ?? null,
      startedAt: now,
      createdById: options.actorId,
    },
  });

  await prisma.milestone.update({
    where: { id: milestone.id },
    data: {
      status: "BLOCKED",
      statusBeforeBlock: milestone.status,
      blockedReason: options.reason,
      blockedNote: options.note,
      blockingMilestoneId: options.blockingMilestoneId ?? null,
      blockedSince: now,
    },
  });

  await recordStatusChange({
    milestoneId: milestone.id,
    title: milestone.title,
    from: milestone.status as MilestoneStatus,
    to: "BLOCKED",
    actorId: options.actorId,
    reason: `${BLOCK_REASON_LABEL[options.reason]}: ${options.note}`,
  });

  // The owner hears about every block, because the deadline just moved.
  for (const admin of await admins()) {
    await notify({
      userId: admin.id,
      type: "TASK_ASSIGNED",
      title: "Work blocked",
      body: `${milestone.assignee?.name ?? "Someone"} blocked "${milestone.title}" — ${BLOCK_REASON_LABEL[
        options.reason
      ].toLowerCase()}: ${options.note}`,
      href: `/board?milestone=${milestone.id}`,
      milestoneId: milestone.id,
    });
  }

  return { ok: true, blockPeriodId: period.id };
}

export type UnblockResult = { ok: true; minutes: number } | { ok: false; reason: string };

/**
 * Closes the running block and returns the milestone to what it was doing.
 *
 * `vetoed` marks the period as not counting. The period itself is kept either
 * way, so the record shows both that the block was raised and how it ended.
 */
export async function unblockMilestone(options: {
  milestoneId: string;
  actorId: string;
  vetoed?: boolean;
  vetoNote?: string | null;
  now?: Date;
}): Promise<UnblockResult> {
  const now = options.now ?? new Date();

  const milestone = await prisma.milestone.findUnique({
    where: { id: options.milestoneId },
    include: { assignee: { select: { id: true, name: true } } },
  });
  if (!milestone) return { ok: false, reason: "That milestone no longer exists." };
  if (milestone.status !== "BLOCKED") return { ok: false, reason: "It isn't blocked." };

  const period = await prisma.blockPeriod.findFirst({
    where: { milestoneId: milestone.id, endedAt: null },
    orderBy: { startedAt: "desc" },
  });

  const minutes = period ? minutesBetween(period.startedAt, now) : 0;
  const counts = !options.vetoed;

  if (period) {
    await prisma.blockPeriod.update({
      where: { id: period.id },
      data: {
        endedAt: now,
        minutes,
        releasedById: options.actorId,
        vetoed: Boolean(options.vetoed),
        vetoNote: options.vetoNote ?? null,
      },
    });
  }

  const restored = (milestone.statusBeforeBlock ?? "IN_PROGRESS") as MilestoneStatus;

  await prisma.milestone.update({
    where: { id: milestone.id },
    data: {
      status: restored,
      statusBeforeBlock: null,
      blockedReason: null,
      blockedNote: null,
      blockingMilestoneId: null,
      blockedSince: null,
      // A vetoed block buys no time.
      ...(counts ? { blockedMinutes: milestone.blockedMinutes + minutes } : {}),
    },
  });

  await recordStatusChange({
    milestoneId: milestone.id,
    title: milestone.title,
    from: "BLOCKED",
    to: restored,
    actorId: options.actorId,
    reason: options.vetoed
      ? `Block overruled${options.vetoNote ? `: ${options.vetoNote}` : ""} — no time added`
      : `Unblocked after ${describeBlocked(minutes)}`,
  });

  if (options.vetoed && milestone.assigneeId) {
    await notify({
      userId: milestone.assigneeId,
      type: "WORK_REJECTED",
      title: "Block overruled",
      body: `"${milestone.title}" is back in progress and its deadline did not move.${
        options.vetoNote ? ` ${options.vetoNote}` : ""
      }`,
      href: "/my-tasks",
      milestoneId: milestone.id,
    });
  }

  return { ok: true, minutes: counts ? minutes : 0 };
}

/**
 * Releases everything that was waiting on a milestone that just completed.
 *
 * Called from the status route on approval. Each dependent returns to whatever
 * it was doing before the block and its assignee is told, so nobody has to
 * poll the board to notice they can start again.
 */
export async function releaseDependents(
  blockingMilestoneId: string,
  actorId: string,
  now: Date = new Date(),
): Promise<number> {
  const waiting = await prisma.milestone.findMany({
    where: { blockingMilestoneId, status: "BLOCKED" },
    select: { id: true, title: true, assigneeId: true },
  });

  let released = 0;

  for (const dependent of waiting) {
    const result = await unblockMilestone({
      milestoneId: dependent.id,
      actorId,
      now,
    });
    if (!result.ok) continue;
    released += 1;

    if (dependent.assigneeId) {
      await notify({
        userId: dependent.assigneeId,
        type: "TASK_ASSIGNED",
        title: "You're unblocked",
        body: `"${dependent.title}" was waiting on work that has just been approved. Its deadline moved by ${describeBlocked(
          result.minutes,
        )}.`,
        href: "/my-tasks",
        milestoneId: dependent.id,
      });
    }
  }

  return released;
}

async function admins() {
  return prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
}

/**
 * Blocked days a client is responsible for, per project.
 *
 * Only CLIENT periods count, and only ones that were not vetoed. This is the
 * number that turns "you delivered late" into a conversation about who was
 * waiting on whom.
 */
export async function clientBlockedDays(
  clientId: string,
  now: Date = new Date(),
): Promise<{
  totalMinutes: number;
  totalDays: number;
  openItems: {
    milestoneId: string;
    title: string;
    since: Date;
    note: string;
    /** How long it has been waiting, as of `now`. */
    minutes: number;
  }[];
}> {
  const periods = await prisma.blockPeriod.findMany({
    where: {
      reason: "CLIENT",
      vetoed: false,
      milestone: { module: { project: { clientId } } },
    },
    select: {
      minutes: true,
      startedAt: true,
      endedAt: true,
      note: true,
      milestone: { select: { id: true, title: true } },
    },
  });

  let totalMinutes = 0;
  const openItems: {
    milestoneId: string;
    title: string;
    since: Date;
    note: string;
    minutes: number;
  }[] = [];

  for (const period of periods) {
    if (period.endedAt) {
      totalMinutes += period.minutes ?? 0;
      continue;
    }

    // Still waiting: count the time so far, and list it as outstanding. The
    // elapsed figure is carried on the item so a caller can't accidentally
    // recompute it against a different reference point — a report period end,
    // for instance, which is in the past and would render every live block as
    // "0 days".
    const minutes = minutesBetween(period.startedAt, now);
    totalMinutes += minutes;
    openItems.push({
      milestoneId: period.milestone.id,
      title: period.milestone.title,
      since: period.startedAt,
      note: period.note,
      minutes,
    });
  }

  return {
    totalMinutes,
    totalDays: Math.round((totalMinutes / (60 * 24)) * 10) / 10,
    openItems,
  };
}
