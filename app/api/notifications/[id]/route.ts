import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";

/** Mark one notification read. Scoped to the owner — never by id alone. */
export async function PATCH(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const notification = await prisma.notification.findUnique({
    where: { id: params.id },
    select: { userId: true },
  });
  if (!notification) return apiError("That notification no longer exists", 404);
  if (notification.userId !== user.id) {
    return apiError("That notification isn't yours", 403);
  }

  try {
    const updated = await prisma.notification.update({
      where: { id: params.id },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ notification: updated });
  } catch {
    return apiError("Couldn't update that notification", 500);
  }
}
