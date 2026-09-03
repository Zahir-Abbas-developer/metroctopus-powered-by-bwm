import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { liveBlockedMinutes } from "@/lib/blocking";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import type { ActivityType } from "@/lib/activity";
import { hasAdminPower } from "@/lib/constants";

/** Everything the milestone drawer renders, in one request. */
export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    include: {
      assignee: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      module: {
        select: {
          id: true,
          name: true,
          project: {
            select: {
              id: true,
              title: true,
              endDate: true,
              client: { select: { id: true, businessName: true } },
            },
          },
        },
      },
      scoreEvents: { select: { points: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, name: true, avatarColor: true } },
          mentions: { select: { userId: true } },
        },
      },
      attachments: {
        orderBy: { createdAt: "desc" },
        include: { uploader: { select: { id: true, name: true } } },
      },
      activity: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { actor: { select: { id: true, name: true, avatarColor: true } } },
      },
    },
  });

  if (!milestone) return apiError("That milestone no longer exists", 404);

  // Members may open their own work. Anything else is not theirs to read.
  if (!hasAdminPower(user.role) && milestone.assigneeId !== user.id) {
    return apiError("That milestone isn't assigned to you", 403);
  }

  const members = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, avatarColor: true, jobTitle: true },
  });

  return NextResponse.json({
    milestone: {
      id: milestone.id,
      title: milestone.title,
      description: milestone.description,
      weight: milestone.weight,
      dueDate: milestone.dueDate,
      status: milestone.status,
      submittedAt: milestone.submittedAt,
      completedAt: milestone.completedAt,
      assignee: milestone.assignee,
      moduleName: milestone.module.name,
      projectId: milestone.module.project.id,
      projectTitle: milestone.module.project.title,
      clientName: milestone.module.project.client.businessName,
      scoreImpact: milestone.scoreEvents.reduce((sum, event) => sum + event.points, 0),
      blockedReason: milestone.blockedReason,
      blockedNote: milestone.blockedNote,
      blockedSince: milestone.blockedSince,
      blockedMinutes: liveBlockedMinutes(milestone),
      adminReviewMinutes: milestone.adminReviewMinutes,
      qualityRating: milestone.qualityRating,
      qualityComment: milestone.qualityComment,
    },
    comments: milestone.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      parentId: comment.parentId,
      createdAt: comment.createdAt,
      author: comment.user,
      mentionedIds: comment.mentions.map((mention) => mention.userId),
    })),
    attachments: milestone.attachments.map((attachment) => ({
      id: attachment.id,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      createdAt: attachment.createdAt,
      uploader: attachment.uploader,
      isImage: attachment.mimeType.startsWith("image/"),
      url: `/api/attachments/${attachment.id}/raw`,
    })),
    activity: milestone.activity.map((entry) => ({
      id: entry.id,
      type: entry.type as ActivityType,
      summary: entry.summary,
      detail: entry.detail,
      createdAt: entry.createdAt,
      actor: entry.actor,
    })),
    members,
  });
}
