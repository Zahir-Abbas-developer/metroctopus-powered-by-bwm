import { prisma } from "@/lib/prisma";
import { dueDeadline } from "@/lib/date";
import { applyEvents } from "@/lib/score-service";
import { evaluateCompletion, evaluateMissed, type MilestoneFacts } from "@/lib/scoring";

/**
 * The daily evaluation pass.
 *
 * Three jobs, in order:
 *   1. Report which open milestones are past their deadline.
 *   2. Catch up any LATE / EARLY_BONUS charge that the approval handler didn't
 *      already write (data imports, a failed request, a manual DB edit).
 *   3. Close out projects whose end date has passed: anything unfinished is
 *      marked MISSED and charged, and the project's own status is settled.
 *
 * Every write is idempotent. Score events collide on their unique dedupe key,
 * and close-out is gated on `closedOutAt`, so running this ten times in a row
 * produces exactly the same ledger as running it once.
 *
 * On "marks overdue milestones": a milestone that is past due inside a running
 * project is deliberately NOT forced to MISSED. The member can still deliver it
 * late, and forcing the status would both break their PENDING -> IN_PROGRESS ->
 * SUBMITTED flow and store a fact the due date already tells us. Overdue is
 * derived for display; MISSED is a real, charged state that only happens at
 * close-out. The pass reports the overdue count so the run is still auditable.
 */

export type EvaluationResult = {
  ranAt: string;
  overdueOpen: number;
  lateOrBonusApplied: number;
  projectsClosed: number;
  milestonesMissed: number;
  missedPointsApplied: number;
};

export async function runEvaluation(now: Date = new Date()): Promise<EvaluationResult> {
  const overdueOpen = await countOverdueOpen(now);
  const lateOrBonusApplied = await catchUpCompletions();
  const closeout = await closeOutEndedProjects(now);

  return {
    ranAt: now.toISOString(),
    overdueOpen,
    lateOrBonusApplied,
    ...closeout,
  };
}

/** Open milestones whose deadline has passed. Reported, not mutated. */
async function countOverdueOpen(now: Date): Promise<number> {
  const open = await prisma.milestone.findMany({
    where: { status: { in: ["PENDING", "IN_PROGRESS", "SUBMITTED"] } },
    select: { dueDate: true },
  });

  return open.filter((milestone) => dueDeadline(milestone.dueDate) < now).length;
}

/** Charge (or credit) any approved milestone the ledger hasn't seen yet. */
async function catchUpCompletions(): Promise<number> {
  const completed = await prisma.milestone.findMany({
    where: {
      status: "COMPLETED",
      completedAt: { not: null },
      assigneeId: { not: null },
    },
    select: {
      id: true,
      title: true,
      weight: true,
      dueDate: true,
      completedAt: true,
      assigneeId: true,
    },
  });

  const existingKeys = await loadDedupeKeys(completed.map((milestone) => milestone.id));

  let applied = 0;
  for (const milestone of completed) {
    const proposals = evaluateCompletion(toFacts(milestone), existingKeys);
    applied += await applyEvents(proposals, { at: milestone.completedAt ?? undefined });
  }

  return applied;
}

/**
 * Settle every project whose cycle has ended: unfinished milestones become
 * MISSED and are charged, then the project itself is marked COMPLETED or
 * OVERDUE_CLOSEOUT. `closedOutAt` makes this run once per project.
 */
async function closeOutEndedProjects(now: Date) {
  const due = await prisma.project.findMany({
    where: {
      endDate: { lt: now },
      closedOutAt: null,
      status: { in: ["PLANNING", "ACTIVE", "OVERDUE_CLOSEOUT"] },
    },
    include: {
      modules: {
        include: {
          milestones: {
            select: {
              id: true,
              title: true,
              weight: true,
              dueDate: true,
              status: true,
              completedAt: true,
              assigneeId: true,
            },
          },
        },
      },
    },
  });

  let projectsClosed = 0;
  let milestonesMissed = 0;
  let missedPointsApplied = 0;

  for (const project of due) {
    const milestones = project.modules.flatMap((module) => module.milestones);
    const unfinished = milestones.filter((milestone) => milestone.status !== "COMPLETED");

    const existingKeys = await loadDedupeKeys(unfinished.map((milestone) => milestone.id));

    for (const milestone of unfinished) {
      if (milestone.status !== "MISSED") {
        await prisma.milestone.update({
          where: { id: milestone.id },
          data: { status: "MISSED" },
        });
        milestonesMissed += 1;
      }

      const proposals = evaluateMissed(toFacts(milestone), existingKeys);
      missedPointsApplied += await applyEvents(proposals, { at: project.endDate });
    }

    await prisma.project.update({
      where: { id: project.id },
      data: {
        status: unfinished.length === 0 ? "COMPLETED" : "OVERDUE_CLOSEOUT",
        closedOutAt: now,
      },
    });
    projectsClosed += 1;
  }

  return { projectsClosed, milestonesMissed, missedPointsApplied };
}

async function loadDedupeKeys(milestoneIds: string[]): Promise<Set<string>> {
  if (milestoneIds.length === 0) return new Set();

  const events = await prisma.scoreEvent.findMany({
    where: { milestoneId: { in: milestoneIds }, dedupeKey: { not: null } },
    select: { dedupeKey: true },
  });

  return new Set(events.map((event) => event.dedupeKey!).filter(Boolean));
}

function toFacts(milestone: {
  id: string;
  title: string;
  weight: number;
  dueDate: Date;
  completedAt: Date | null;
  assigneeId: string | null;
}): MilestoneFacts {
  return {
    id: milestone.id,
    title: milestone.title,
    weight: milestone.weight,
    deadline: dueDeadline(milestone.dueDate),
    completedAt: milestone.completedAt,
    assigneeId: milestone.assigneeId,
  };
}
