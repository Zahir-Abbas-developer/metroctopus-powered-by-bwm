import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { generatePassword, hashPassword } from "@/lib/passwords";
import { reset } from "@/lib/rate-limit";

/**
 * Give a team member a fresh temporary password.
 *
 * The Team page already let an admin type a new password into the member's
 * edit form, but on a phone that form sat behind the last column of a wide
 * table, and it asked the admin to invent a password — which then stayed
 * theirs to know, because nothing made the member replace it. This generates
 * one, returns it exactly once so it can be passed on, and marks the account
 * so the member chooses their own at the next sign-in.
 *
 * Deliberately not for your own account: you would be signed in, holding a
 * password you had never seen typed, and immediately forced to change it. The
 * change-password flow is the way to change your own.
 */
export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  if (admin!.id === params.id) {
    return apiError("Reset other people's passwords here. Change your own from your account.", 400);
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, email: true, isActive: true },
  });
  if (!target) return apiError("That team member no longer exists", 404);
  if (!target.isActive) {
    return apiError(`${target.name} is deactivated — restore them before resetting their password`, 409);
  }

  const password = generatePassword();

  await prisma.user.update({
    where: { id: target.id },
    data: {
      passwordHash: await hashPassword(password),
      mustChangePassword: true,
    },
  });

  // Someone who has been locked out by failed attempts should be able to use
  // the new password straight away. The counter is per server instance, so
  // this is best effort — but it is the instance most likely to see them next.
  reset(`login:user:${target.email}`);

  await recordAudit({
    actorId: admin!.id,
    action: "PASSWORD_RESET",
    entityType: "User",
    entityId: target.id,
    summary: `Reset ${target.name}'s password`,
  });

  return NextResponse.json({
    member: { id: target.id, name: target.name, email: target.email },
    // Returned once, stored nowhere but as a hash.
    password,
  });
}
