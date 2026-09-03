import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { hasAdminPower } from "@/lib/constants";

/** Remove an attachment. The uploader or the owner may do it. */
export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const attachment = await prisma.attachment.findUnique({
    where: { id: params.id },
    select: { id: true, uploaderId: true },
  });
  if (!attachment) return apiError("That file no longer exists", 404);

  if (!hasAdminPower(user.role) && attachment.uploaderId !== user.id) {
    return apiError("You can only remove files you uploaded", 403);
  }

  try {
    // The row goes; the bytes are left on disk deliberately. Reclaiming them
    // belongs in a sweep job, not in a request that a user is waiting on.
    await prisma.attachment.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return apiError("Couldn't remove that file", 500);
  }
}
