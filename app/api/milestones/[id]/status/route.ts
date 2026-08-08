import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { canTransition, type MilestoneStatus } from "@/lib/constants";
import { fieldErrors, transitionSchema } from "@/lib/validation";
import { dueDeadline } from "@/lib/date";
import { applyEvents } from "@/lib/score-service";
import {
  evaluateCompletion,
  evaluateMissed,
  qualityEvent,
  rejectionEvent,
  requiresQualityComment,
} from "@/lib/scoring";
import { getSettings } from "@/lib/settings";
import { notifyApproved, notifyRejected } from "@/lib/notifications";
import { recordScoreEvent, recordStatusChange } from "@/lib/activity";
import { releaseDependents } from "@/lib/blocking";
import { canDecideMilestone } from "@/lib/permissions";
import { actorFor } from "@/lib/permissions-service";
import { recordAudit } from "@/lib/audit";

/**
 * The one place a milestone's status can change, because every scoring
 * consequence hangs off these transitions:
 *
 *   -> SUBMITTED              stamps submittedAt — the moment lateness is
 *                             judged on, from Phase 8 onwards
 *   -> COMPLETED (admin)      stamps completedAt, the review time and the
 *                             quality rating, then charges LATE or pays
 *                             EARLY_BONUS against the *submission*, plus a
 *                             quality bonus or flag
 *   SUBMITTED -> IN_PROGRESS  a rejection: requires a written reason, charges
 *                (admin)      weight x 0.5, and clears submittedAt so the
 *                             resubmission is what gets timed
 *   -> MISSED (admin)         charges weight x 4, but only if nothing was ever
 *                             submitted
 *
 * Members drive their own work forward but can never approve it. Approval is
 * what releases the work to the client, so self-approval would make delivery
 * self-reported — but approval no longer times anything, so an owner sitting on
 * a review can no longer cost a member points.
 *
 * Phase 11: a **Service Lead** carries the owner's approval authority inside
 * their own service lines, and never over their own work. See
 * lib/permissions.ts — that check is the load-bearing one and it lives in a
 * pure function with its own tests.
 *
 * BLOCKED is not reachable from here; see lib/blocking.ts and the /block route.
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

  const actor = await actorFor(user);
  const serviceId = milestone.module.serviceId;

  // Who is deciding, and with what authority. `as` is "ADMIN" for the owner,
  // "LEAD" for a service lead acting inside their lines — the audit log and
  // the activity feed both carry it.
  const decision = canDecideMilestone(actor, {
    assigneeId: milestone.assigneeId,
    serviceId,
  });
  const canDecide = decision.allowed;
  // "isAdmin" now means "may make an owner-level decision", which is the sense
  // every use of it below actually wants.
  const isAdmin = canDecide;

  if (!canDecide && milestone.assigneeId !== user.id) {
    return apiError(
      decision.reason ?? "You can only update milestones assigned to you",
      403,
    );
  }

  const from = milestone.status as MilestoneStatus;
  const to = parsed.data.status;

  if (from === to) return NextResponse.json({ milestone, scored: 0 });

  // A lead exercises the admin transition matrix inside their scope.
  if (!canTransition(canDecide ? "ADMIN" : user.role, from, to)) {
    return apiError(
      canDecide
        ? `A milestone can't go from ${from} to ${to}`
        : // `decision.reason` is the specific one — "you can't decide on your
          // own work" for a lead's own milestone, rather than the generic
          // role message, which is exactly the case they need explaining.
          (decision.reason ??
            "Only the agency owner or the service lead can approve or close a milestone"),
      403,
    );
  }

  const isRejection = canDecide && from === "SUBMITTED" && to === "IN_PROGRESS";
  const reason = parsed.data.reason?.trim() ?? "";

  if (isRejection && reason.length < 5) {
    return apiError("Say what needs reworking — the member is charged points for this", 422, {
      reason: "A rejection needs a written reason",
    });
  }

  // Approval carries a judgement on the work, not just a timestamp. Punctuality
  // was never the whole story — work can land on time and still be wrong.
  const rating = parsed.data.qualityRating ?? null;
  const qualityComment = parsed.data.qualityComment?.trim() ?? "";

  if (to === "COMPLETED" && canDecide) {
    if (rating === null) {
      return apiError("Rate the work before approving it", 422, {
        qualityRating: "Pick 1–5 stars",
      });
    }
    // A low score the member cannot act on is just a number that makes them
    // feel bad, so the comment is mandatory rather than encouraged.
    if (requiresQualityComment(rating) && qualityComment.length < 5) {
      return apiError("Say what fell short — a low rating without a reason isn't actionable", 422, {
        qualityComment: "Required for 1–2 stars",
      });
    }
  }

  const now = new Date();
  const settings = await getSettings();

  // An owner approving work that was never submitted has no delivery moment to
  // time. Stamping the approval as the submission is the honest reading — the
  // record then says "delivered now" — and it keeps every scored milestone on
  // one basis rather than quietly falling back to approval time.
  const submittedAt =
    to === "SUBMITTED"
      ? now
      : to === "COMPLETED"
        ? (milestone.submittedAt ?? now)
        : isRejection
          ? null
          : milestone.submittedAt;

  const facts = {
    id: milestone.id,
    title: milestone.title,
    weight: milestone.weight,
    deadline: dueDeadline(milestone.dueDate),
    blockedMinutes: milestone.blockedMinutes,
    submittedAt,
    completedAt: to === "COMPLETED" ? now : milestone.completedAt,
    assigneeId: milestone.assigneeId,
  };

  // The owner's own clock: submission to decision. Tracked on approvals and
  // rejections alike, because both are decisions the member was waiting on.
  const decided = to === "COMPLETED" || isRejection;
  const reviewMinutes =
    decided && milestone.submittedAt
      ? Math.max(0, Math.round((now.getTime() - milestone.submittedAt.getTime()) / 60_000))
      : null;

  try {
    const updated = await prisma.milestone.update({
      where: { id: params.id },
      data: {
        status: to,
        // Rejection clears the stamp so the resubmission is what gets timed.
        // The rejection charge already covers the quality miss; timing the
        // first attempt as well would punish one mistake twice.
        submittedAt,
        ...(to === "COMPLETED" ? { completedAt: now } : {}),
        ...(reviewMinutes !== null ? { adminReviewMinutes: reviewMinutes } : {}),
        ...(to === "COMPLETED" && rating !== null
          ? {
              qualityRating: rating,
              qualityComment: qualityComment || null,
              qualityRatedAt: now,
            }
          : {}),
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

      // The quality judgement, into the same ledger as everything else.
      if (rating !== null) {
        const event = qualityEvent(
          { id: milestone.id, title: milestone.title, assigneeId: milestone.assigneeId },
          rating,
          qualityComment || null,
          { bonusHigh: settings.bonusQualityHigh, penaltyLow: settings.penaltyQualityLow },
        );

        if (event) {
          scored += await applyEvents([event], { at: now, createdById: user.id });
          await recordScoreEvent({
            milestoneId: milestone.id,
            userName: updated.assignee?.name ?? "the assignee",
            type: event.type,
            points: event.points,
            reason: event.reason,
            actorId: user.id,
          });
        }
      }

      await recordAudit({
        actorId: user.id,
        action: "MILESTONE_APPROVED",
        entityType: "Milestone",
        entityId: milestone.id,
        summary: `Approved "${milestone.title}" at ${rating ?? "—"} stars`,
        before: { status: from, qualityRating: milestone.qualityRating },
        after: { status: to, qualityRating: rating },
        asLead: decision.as === "LEAD",
      });

      // Anything that was waiting on this milestone starts moving again.
      await releaseDependents(milestone.id, user.id, now);
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

      await recordAudit({
        actorId: user.id,
        action: "MILESTONE_REJECTED",
        entityType: "Milestone",
        entityId: milestone.id,
        summary: `Sent "${milestone.title}" back: ${reason}`,
        before: { status: from },
        after: { status: to },
        asLead: decision.as === "LEAD",
      });

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
      // Only work that was never handed in can be MISSED. Something sitting in
      // the review queue was delivered; that it hasn't been signed off is the
      // owner's backlog.
      scored = await applyEvents(
        evaluateMissed({ ...facts, completedAt: null, submittedAt: milestone.submittedAt }),
        { at: now },
      );
    }

    return NextResponse.json({ milestone: updated, scored });
  } catch {
    return apiError("Couldn't update this milestone", 500);
  }
}
