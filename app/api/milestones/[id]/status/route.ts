import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { canTransition, type MilestoneStatus } from "@/lib/constants";
import { fieldErrors, transitionSchema } from "@/lib/validation";
import { dueDeadline } from "@/lib/date";
import { applyEvents } from "@/lib/score-service";
import { evaluateCompletion, evaluateMissed, rejectionEvent } from "@/lib/scoring";
import { notifyApproved, notifyRejected } from "@/lib/notifications";
import { recordScoreEvent, recordStatusChange } from "@/lib/activity";

/**
 * The one place a milestone's status can change, because every scoring
 * consequence hangs off these transitions:
 *
 *   -> SUBMITTED              stamps submittedAt
 *   -> COMPLETED (admin)      stamps completedAt, then charges LATE or pays
 *                             EARLY_BONUS
 *   SUBMITTED -> IN_PROGRESS  a rejection: requires a written reason and
 *                (admin)      charges weight x 0.5
 *   -> MISSED (admin)         charges weight x 4
 *
 * Members drive their own work forward but can never approve it. Completion is
 * what the score pays out on, so self-approval would make the whole measure
 * self-reported.
 */
export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = transitionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    include: { module: { include: { project: true } } },
  });
  if (!milestone) return apiError("That milestone no longer exists", 404);

  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && milestone.assigneeId !== user.id) {
    return apiError("You can only update milestones assigned to you", 403);
  }

  const from = milestone.status as MilestoneStatus;
  const to = parsed.data.status;

  if (from === to) return NextResponse.json({ milestone, scored: 0 });

  if (!canTransition(user.role, from, to)) {
    return apiError(
      isAdmin
        ? `A milestone can't go from ${from} to ${to}`
        : "Only the agency owner can approve or close a milestone",
      403,
    );
  }

  const isRejection = isAdmin && from === "SUBMITTED" && to === "IN_PROGRESS";
  const reason = parsed.data.reason?.trim() ?? "";

  if (isRejection && reason.length < 5) {
    return apiError("Say what needs reworking — the member is charged points for this", 422, {
      reason: "A rejection needs a written reason",
    });
  }

  const now = new Date();
  const facts = {
    id: milestone.id,
    title: milestone.title,
    weight: milestone.weight,
    deadline: dueDeadline(milestone.dueDate),
    completedAt: to === "COMPLETED" ? now : milestone.completedAt,
    assigneeId: milestone.assigneeId,
  };

  try {
    const updated = await prisma.milestone.update({
      where: { id: params.id },
      data: {
        status: to,
        ...(to === "SUBMITTED" ? { submittedAt: now } : {}),
        ...(to === "COMPLETED" ? { completedAt: now } : {}),
        // Reverting an approval clears the stamp, but the ledger entry it
        // produced stays — history is append-only. Use a manual adjustment to
        // compensate if an approval was genuinely a mistake.
        ...(to !== "COMPLETED" && milestone.completedAt ? { completedAt: null } : {}),
      },
      include: { assignee: { select: { id: true, name: true, avatarColor: true } } },
    });

    await recordStatusChange({
      milestoneId: milestone.id,
      title: milestone.title,
      from,
      to,
      actorId: user.id,
      reason: isRejection ? reason : null,
    });

    let scored = 0;

    if (to === "COMPLETED") {
      const proposals = evaluateCompletion(facts);
      scored = await applyEvents(proposals, { at: now });

      for (const proposal of proposals) {
        await recordScoreEvent({
          milestoneId: milestone.id,
          userName: updated.assignee?.name ?? "the assignee",
          type: proposal.type,
          points: proposal.points,
          reason: proposal.reason,
        });
      }

      if (milestone.assigneeId) {
        await notifyApproved({
          id: milestone.id,
          title: milestone.title,
          assigneeId: milestone.assigneeId,
          points: proposals.reduce((sum, event) => sum + event.points, 0),
        });
      }
    } else if (isRejection) {
      const event = rejectionEvent(
        { id: milestone.id, title: milestone.title, weight: milestone.weight, assigneeId: milestone.assigneeId },
        reason,
      );
      scored = event ? await applyEvents([event], { at: now, createdById: user.id }) : 0;

      if (event) {
        await recordScoreEvent({
          milestoneId: milestone.id,
          userName: updated.assignee?.name ?? "the assignee",
          type: event.type,
          points: event.points,
          reason: event.reason,
          actorId: user.id,
        });
      }

      if (event) {
        await notifyRejected({
          id: milestone.id,
          title: milestone.title,
          assigneeId: event.userId,
          reason,
          points: event.points,
        });
      }
    } else if (to === "MISSED") {
      scored = await applyEvents(evaluateMissed({ ...facts, completedAt: null }), { at: now });
    }

    return NextResponse.json({ milestone: updated, scored });
  } catch {
    return apiError("Couldn't update this milestone", 500);
  }
}
