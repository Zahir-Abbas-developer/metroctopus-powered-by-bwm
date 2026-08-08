import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { mentionedUserIds } from "@/lib/mentions";
import { notify } from "@/lib/notifications";
import { recordComment } from "@/lib/activity";

const commentSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Write something first")
    .max(4000, "Keep a comment under 4000 characters"),
  /** Present when replying to an existing comment. */
  parentId: z.string().min(1).nullish(),
});

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = commentSchema.safeParse(payload);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const milestone = await prisma.milestone.findUnique({
    where: { id: params.id },
    select: { id: true, title: true, assigneeId: true },
  });
  if (!milestone) return apiError("That milestone no longer exists", 404);

  if (user.role !== "ADMIN" && milestone.assigneeId !== user.id) {
    return apiError("You can only comment on your own milestones", 403);
  }

  // A reply must belong to the same milestone, or a crafted parentId could
  // graft a thread from one record onto another.
  let parentId: string | null = null;
  if (parsed.data.parentId) {
    const parent = await prisma.comment.findUnique({
      where: { id: parsed.data.parentId },
      select: { id: true, milestoneId: true, parentId: true },
    });
    if (!parent || parent.milestoneId !== milestone.id) {
      return apiError("That comment isn't on this milestone", 422);
    }
    // One level of threading: a reply to a reply joins the same thread.
    parentId = parent.parentId ?? parent.id;
  }

  const members = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });

  const mentioned = mentionedUserIds(parsed.data.body, members).filter(
    (id) => id !== user.id,
  );

  try {
    const comment = await prisma.comment.create({
      data: {
        milestoneId: milestone.id,
        userId: user.id,
        body: parsed.data.body,
        parentId,
        mentions: { create: mentioned.map((userId) => ({ userId })) },
      },
      include: {
        user: { select: { id: true, name: true, avatarColor: true } },
        mentions: { select: { userId: true } },
      },
    });

    await recordComment({
      milestoneId: milestone.id,
      title: milestone.title,
      actorId: user.id,
      excerpt: excerpt(parsed.data.body),
    });

    for (const userId of mentioned) {
      await notify({
        userId,
        type: "TASK_ASSIGNED",
        title: `${user.name ?? "Someone"} mentioned you`,
        body: `${milestone.title}: ${excerpt(parsed.data.body)}`,
        href: `/board?milestone=${milestone.id}`,
        milestoneId: milestone.id,
      });
    }

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          body: comment.body,
          parentId: comment.parentId,
          createdAt: comment.createdAt,
          author: comment.user,
          mentionedIds: comment.mentions.map((mention) => mention.userId),
        },
        notified: mentioned.length,
      },
      { status: 201 },
    );
  } catch {
    return apiError("Couldn't post that comment", 500);
  }
}

function excerpt(body: string): string {
  const clean = body.replace(/\s+/g, " ").trim();
  return clean.length > 140 ? `${clean.slice(0, 137)}…` : clean;
}
