import { prisma } from "@/lib/prisma";
import { toDateOnly } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import {
  carryOverDueDate,
  cycleTitle,
  nextCycleWindow,
  shiftDueDate,
  shouldCarryOver,
  type RenewalWindow,
} from "@/lib/renewal-plan";

/**
 * Auto-renewal: the 1st of the month runs itself.
 *
 * The owner's most reliable recurring chore was rebuilding every active
 * client's plan at the start of a cycle. This does it overnight, from the
 * structure the previous cycle actually ended up with rather than from the
 * service templates — because a month of edits, added milestones and
 * reassignments is exactly the knowledge that would be thrown away by
 * regenerating from a template.
 *
 * Three properties hold:
 *
 *   **Idempotent.** `Project.renewedFromId` is unique, so a cycle can be
 *   rolled forward exactly once. A second run finds the child already there
 *   and does nothing.
 *
 *   **No double punishment.** Unfinished work is copied with `carriedOver`
 *   set. The MISSED penalty from the closed cycle was charged there and is
 *   never charged again — the copy is a fresh milestone with a new deadline
 *   and no history.
 *
 *   **Opt-out is respected.** PAUSED and CHURNED clients never renew, and any
 *   client can be excluded with `autoRenew = false`.
 */

export type RenewedClient = {
  clientId: string;
  clientName: string;
  fromProjectId: string;
  toProjectId: string;
  title: string;
  milestones: number;
  carriedOver: number;
  /** Carried-over items that nobody is assigned to — the owner should look. */
  unassigned: number;
};

export type RenewalRun = {
  ranAt: string;
  renewed: RenewedClient[];
  skipped: { clientName: string; reason: string }[];
  totalCarriedOver: number;
};

/**
 * Rolls every eligible client forward.
 *
 * Eligible means: ACTIVE, `autoRenew` on, and holding a project whose end date
 * has passed and which has not already been renewed.
 */
export async function runAutoRenewal(now = new Date()): Promise<RenewalRun> {
  const settings = await getSettings();

  if (!settings.autoRenewEnabled) {
    return { ranAt: now.toISOString(), renewed: [], skipped: [], totalCarriedOver: 0 };
  }

  const candidates = await prisma.project.findMany({
    where: {
      endDate: { lt: now },
      // Unique, so this is also what makes a second run a no-op.
      renewedInto: null,
      client: { status: "ACTIVE" },
    },
    orderBy: { endDate: "asc" },
    include: {
      client: { select: { id: true, businessName: true, autoRenew: true, status: true } },
      services: true,
      modules: {
        orderBy: { order: "asc" },
        include: { milestones: { orderBy: { order: "asc" } } },
      },
    },
  });

  const renewed: RenewedClient[] = [];
  const skipped: { clientName: string; reason: string }[] = [];

  for (const project of candidates) {
    if (!project.client.autoRenew) {
      skipped.push({
        clientName: project.client.businessName,
        reason: "Auto-renew is switched off for this client",
      });
      continue;
    }

    // A client can only have one live cycle. If someone already opened the
    // next one by hand, renewing would produce a duplicate month.
    const alreadyLive = await prisma.project.findFirst({
      where: {
        clientId: project.clientId,
        id: { not: project.id },
        endDate: { gte: now },
        status: { in: ["PLANNING", "ACTIVE"] },
      },
      select: { id: true },
    });

    if (alreadyLive) {
      skipped.push({
        clientName: project.client.businessName,
        reason: "A newer cycle already exists",
      });
      // Still archive the old one, so it stops showing as live.
      await archive(project.id, now);
      continue;
    }

    renewed.push(await rollForward(project, settings.carryOverDueDays, now));
  }

  const run: RenewalRun = {
    ranAt: now.toISOString(),
    renewed,
    skipped,
    totalCarriedOver: renewed.reduce((sum, entry) => sum + entry.carriedOver, 0),
  };

  if (renewed.length > 0 || skipped.length > 0) await sendDigest(run, now);

  return run;
}

type CandidateProject = Awaited<ReturnType<typeof loadProject>>;

async function loadProject(id: string) {
  return prisma.project.findUniqueOrThrow({
    where: { id },
    include: {
      client: { select: { id: true, businessName: true, autoRenew: true, status: true } },
      services: true,
      modules: {
        orderBy: { order: "asc" },
        include: { milestones: { orderBy: { order: "asc" } } },
      },
    },
  });
}

/** Clones one project's structure into the next window. */
async function rollForward(
  project: NonNullable<CandidateProject>,
  carryOverDays: number,
  now: Date,
): Promise<RenewedClient> {
  const window = nextCycleWindow({
    startDate: project.startDate,
    endDate: project.endDate,
  });

  const next = await prisma.project.create({
    data: {
      clientId: project.clientId,
      title: cycleTitle(window.startDate),
      startDate: toDateOnly(window.startDate),
      endDate: toDateOnly(window.endDate),
      status: window.startDate <= now ? "ACTIVE" : "PLANNING",
      renewedFromId: project.id,
      services: { create: project.services.map((link) => ({ serviceId: link.serviceId })) },
    },
  });

  let milestones = 0;
  let carriedOver = 0;
  let unassigned = 0;

  for (const [index, module] of project.modules.entries()) {
    const created = await prisma.module.create({
      data: {
        projectId: next.id,
        name: module.name,
        serviceId: module.serviceId,
        order: index,
      },
    });

    for (const [order, milestone] of module.milestones.entries()) {
      const carry = shouldCarryOver(milestone.status);

      // Recurring work is re-created fresh; unfinished work is carried with a
      // pointer back to what it continues.
      const dueDate = carry
        ? carryOverDueDate(window, carryOverDays)
        : shiftDueDate(milestone.dueDate, window);

      await prisma.milestone.create({
        data: {
          moduleId: created.id,
          title: milestone.title,
          description: milestone.description,
          weight: milestone.weight,
          estimatedHours: milestone.estimatedHours,
          dueDate: toDateOnly(dueDate),
          order,
          assigneeId: milestone.assigneeId,
          carriedOver: carry,
          carriedFromId: carry ? milestone.id : null,
          // Deliberately not copied: status, submittedAt, completedAt,
          // blocked* and adminReviewMinutes. The copy is a fresh milestone —
          // carrying the old status forward would re-charge a miss that was
          // already paid for in the closed cycle.
        },
      });

      milestones += 1;
      if (carry) {
        carriedOver += 1;
        if (!milestone.assigneeId) unassigned += 1;
      }
    }
  }

  await archive(project.id, now);

  return {
    clientId: project.clientId,
    clientName: project.client.businessName,
    fromProjectId: project.id,
    toProjectId: next.id,
    title: next.title,
    milestones,
    carriedOver,
    unassigned,
  };
}

/**
 * Closes the old cycle.
 *
 * `closedOutAt` is left alone: the evaluation pass owns it, and setting it
 * here would skip the MISSED charges that close-out is responsible for. This
 * only marks the cycle finished and read-only.
 */
async function archive(projectId: string, now: Date): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, archivedAt: true },
  });
  if (!project || project.archivedAt) return;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      archivedAt: now,
      status: project.status === "OVERDUE_CLOSEOUT" ? "OVERDUE_CLOSEOUT" : "COMPLETED",
    },
  });
}

/**
 * The renewals digest.
 *
 * A single notification and email rather than one per client: waking up to
 * five separate "renewed" notices is noise, and the thing the owner actually
 * needs to know is which items need a decision.
 */
async function sendDigest(run: RenewalRun, now: Date): Promise<void> {
  const owners = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true, name: true, email: true },
  });

  const needsAttention =
    run.renewed.filter((entry) => entry.unassigned > 0).length + run.skipped.length;

  const body = [
    run.renewed.length === 0
      ? "No cycles renewed."
      : `${run.renewed.length} client${run.renewed.length === 1 ? "" : "s"} renewed` +
        (run.totalCarriedOver > 0
          ? `, ${run.totalCarriedOver} item${run.totalCarriedOver === 1 ? "" : "s"} carried over.`
          : "."),
    needsAttention > 0
      ? `${needsAttention} need${needsAttention === 1 ? "s" : ""} a look.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const dedupeKey = `renewals:${now.toISOString().slice(0, 10)}`;

  for (const owner of owners) {
    await notify({
      userId: owner.id,
      type: "REPORT_READY",
      title: "Renewals ran",
      body,
      href: "/clients",
      dedupeKey: `${dedupeKey}:${owner.id}`,
    });
  }

  // Email is best-effort and lazily imported, so a deployment with no SMTP
  // never loads the transport.
  //
  // The transport is marked `server-only`, which throws outside a React Server
  // environment — the seed and the CLI walkthrough both reach this. That is
  // expected rather than broken, so it gets one quiet line instead of a stack
  // trace that looks like a failure.
  try {
    const { sendRenewalDigest } = await import("@/lib/email/dispatch");
    await sendRenewalDigest(run);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Client Component")) {
      console.log("  renewal digest email skipped (not a server runtime)");
    } else {
      console.error("renewal digest email failed", message);
    }
  }
}
