import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { recordAudit } from "@/lib/audit";
import { hashPassword, passwordMatches } from "@/lib/passwords";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(10, "Use at least 10 characters")
      .max(200, "That password is too long"),
    confirmPassword: z.string().min(1, "Repeat the new password"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ["confirmPassword"],
    message: "Those passwords don't match",
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    path: ["newPassword"],
    message: "Pick a password you haven't used here before",
  });

/**
 * Change your own password.
 *
 * The current password is required even during the forced first change: the
 * account is reachable by anyone holding the shared placeholder, so proving
 * possession of it is the only thing separating the real person from whoever
 * else was handed the seed credentials.
 */
export async function POST(request: Request) {
  const session = await getCurrentUser();
  if (!session) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { id: true, passwordHash: true, isActive: true },
  });
  if (!user || !user.isActive) return apiError("You must be signed in", 401);

  // Same tolerance as sign-in: this field is where a temporary password copied
  // out of a chat message is pasted, trailing space and all.
  const matches = await passwordMatches(parsed.data.currentPassword, user.passwordHash);
  if (!matches) {
    return apiError("That current password is wrong", 422, {
      currentPassword: "That doesn't match your current password",
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(parsed.data.newPassword),
      // Clearing the flag is what lifts the forced-change redirect.
      mustChangePassword: false,
    },
  });

  await recordAudit({
    actorId: user.id,
    action: "ROLE_CHANGED",
    entityType: "User",
    entityId: user.id,
    summary: "Changed their own password",
  });

  return NextResponse.json({ ok: true });
}
