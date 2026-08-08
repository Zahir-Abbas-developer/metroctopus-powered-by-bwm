import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { createUserSchema, fieldErrors } from "@/lib/validation";
import { avatarColorFor } from "@/lib/constants";

/** Columns safe to return — never the password hash. */
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

export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  try {
    const members = await prisma.user.findMany({
      select: SELECT,
      // Owner first, then active members, then the deactivated ones.
      orderBy: [{ role: "asc" }, { isActive: "desc" }, { name: "asc" }],
    });

    return NextResponse.json({ members });
  } catch {
    return apiError("Couldn't load the team", 500);
  }
}

export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const { name, email, jobTitle, role, password } = parsed.data;

  try {
    const member = await prisma.user.create({
      data: {
        name,
        email,
        jobTitle,
        role,
        passwordHash: await bcrypt.hash(password, 10),
        avatarColor: avatarColorFor(email),
        isActive: true,
      },
      select: SELECT,
    });

    return NextResponse.json({ member }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("That email is already in use", 409, {
        email: "Someone already uses this email",
      });
    }
    return apiError("Couldn't create this team member", 500);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
