import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/passwords";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, updateUserSchema } from "@/lib/validation";
import { hasAdminPower } from "@/lib/constants";

const SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  jobTitle: true,
  avatarColor: true,
  isActive: true,
  createdAt: true,
} as const;

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const target = await prisma.user.findUnique({ where: { id: params.id } });
  if (!target) {
    return apiError("That team member no longer exists", 404);
  }

  const { password, ...rest } = parsed.data;

  // The owner can't lock themselves out of their own workspace.
  const isSelf = admin!.id === target.id;
  if (isSelf && rest.isActive === false) {
    return apiError("You can't deactivate your own account", 400);
  }
  if (isSelf && rest.role === "MEMBER") {
    return apiError("You can't remove your own owner access", 400);
  }

  // Nor can the agency be left with nobody who can administer it.
  if (hasAdminPower(target.role) && (rest.role === "MEMBER" || rest.isActive === false)) {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", isActive: true, id: { not: target.id } },
    });
    if (otherAdmins === 0) {
      return apiError("The agency must keep at least one active owner", 400);
    }
  }

  try {
    const member = await prisma.user.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(password
          ? {
              passwordHash: await hashPassword(password),
              // A password one person chose for another is a handover, not a
              // password: the member replaces it at their next sign-in. Your
              // own, set from here, is simply yours.
              ...(isSelf ? {} : { mustChangePassword: true }),
            }
          : {}),
      },
      select: SELECT,
    });

    return NextResponse.json({ member });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return apiError("That email is already in use", 409, {
        email: "Someone already uses this email",
      });
    }
    return apiError("Couldn't save those changes", 500);
  }
}
