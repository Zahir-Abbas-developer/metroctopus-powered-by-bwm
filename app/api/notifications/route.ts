import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { recentFor, unreadCount } from "@/lib/notifications";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  try {
    const [notifications, unread] = await Promise.all([
      recentFor(user.id),
      unreadCount(user.id),
    ]);

    return NextResponse.json({ notifications, unread });
  } catch {
    return apiError("Couldn't load your notifications", 500);
  }
}

/** Mark everything read. */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  try {
    const result = await prisma.notification.updateMany({
      where: { userId: user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ marked: result.count });
  } catch {
    return apiError("Couldn't update your notifications", 500);
  }
}
