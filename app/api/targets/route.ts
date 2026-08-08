import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { getSettings } from "@/lib/settings";
import { bucketCounts, targetConfig, weekWindow } from "@/lib/pipeline";
import { evaluateWeek } from "@/lib/targets";
import { ACTIVITY_BUCKETS, type ActivityBucket } from "@/lib/pipeline-types";

const saveSchema = z.object({
  userId: z.string().min(1),
  targets: z
    .array(
      z.object({
        bucket: z.enum(ACTIVITY_BUCKETS),
        weeklyTarget: z.number().int().min(0).max(500),
      }),
    )
    .max(ACTIVITY_BUCKETS.length),
});

/**
 * Weekly activity targets and live progress.
 *
 * A member sees their own; the owner sees everyone's. Progress is computed
 * from the same `evaluateWeek` the Sunday job uses, so the bar a member
 * watches all week and the points they end up with cannot disagree.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("userId");

  const isAdmin = user.role === "ADMIN";
  if (requested && requested !== user.id && !isAdmin) {
    return apiError("You can only see your own targets", 403);
  }

  const settings = await getSettings();
  const config = targetConfig(settings);
  const window = weekWindow(new Date());

  const userIds = requested
    ? [requested]
    : isAdmin
      ? (
          await prisma.user.findMany({
            where: { isActive: true },
            orderBy: { name: "asc" },
            select: { id: true },
          })
        ).map((row) => row.id)
      : [user.id];

  const [targets, members] = await Promise.all([
    prisma.activityTarget.findMany({
      where: { userId: { in: userIds }, isActive: true },
      orderBy: { bucket: "asc" },
    }),
    prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, jobTitle: true, avatarColor: true },
    }),
  ]);

  const rows = [];
  for (const member of members) {
    const own = targets.filter((target) => target.userId === member.id);
    const counts = await bucketCounts(member.id, window);

    rows.push({
      member,
      targets: own.map((target) => ({
        bucket: target.bucket,
        weeklyTarget: target.weeklyTarget,
      })),
      outcome: evaluateWeek(
        own.map((target) => ({
          bucket: target.bucket as ActivityBucket,
          weeklyTarget: target.weeklyTarget,
        })),
        counts,
        config,
      ),
    });
  }

  return NextResponse.json({
    week: { start: window.start.toISOString(), end: window.end.toISOString() },
    config,
    rows,
  });
}

/** Setting targets is the owner's job — they're what a member is measured on. */
export async function PUT(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = saveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const member = await prisma.user.findUnique({
    where: { id: parsed.data.userId },
    select: { id: true },
  });
  if (!member) return apiError("That member no longer exists", 404);

  for (const target of parsed.data.targets) {
    if (target.weeklyTarget === 0) {
      // Zero means "not measured on this". Deactivating rather than deleting
      // keeps last week's evaluation reproducible.
      await prisma.activityTarget.updateMany({
        where: { userId: member.id, bucket: target.bucket },
        data: { isActive: false },
      });
      continue;
    }

    await prisma.activityTarget.upsert({
      where: { userId_bucket: { userId: member.id, bucket: target.bucket } },
      update: { weeklyTarget: target.weeklyTarget, isActive: true },
      create: {
        userId: member.id,
        bucket: target.bucket,
        weeklyTarget: target.weeklyTarget,
        isActive: true,
      },
    });
  }

  const saved = await prisma.activityTarget.findMany({
    where: { userId: member.id, isActive: true },
    orderBy: { bucket: "asc" },
  });

  return NextResponse.json({ targets: saved });
}
