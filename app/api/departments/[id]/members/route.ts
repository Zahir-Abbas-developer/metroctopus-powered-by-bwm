import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { serializeSkills } from "@/lib/skills";
import { DEPT_ROLES } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";

const membersSchema = z.object({
  members: z
    .array(
      z.object({
        userId: z.string().min(1),
        roleInDept: z.enum(DEPT_ROLES).default("MEMBER"),
        skills: z.array(z.string().trim().max(40)).max(24).default([]),
      }),
    )
    .max(200),
});

/**
 * Replaces a department's membership list in one call.
 *
 * Sending the whole list rather than add/remove deltas means the result does
 * not depend on the client and server agreeing about the current state — two
 * admins editing at once converge on a list rather than on a half-applied set
 * of operations.
 */
export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = membersSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const department = await prisma.department.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!department) return apiError("That department no longer exists", 404);

  const wanted = parsed.data.members;
  const userIds = wanted.map((m) => m.userId);

  // A membership pointing at a deleted or deactivated account would scope
  // records to somebody who cannot sign in.
  const users = await prisma.user.findMany({
    where: { id: { in: userIds }, isActive: true },
    select: { id: true },
  });
  if (users.length !== new Set(userIds).size) {
    return apiError("One of those people is no longer active", 422, {
      members: "Refresh and pick the team again",
    });
  }

  await prisma.$transaction([
    prisma.departmentMembership.deleteMany({
      where: { departmentId: department.id, userId: { notIn: userIds.length ? userIds : ["_none"] } },
    }),
    ...wanted.map((m) =>
      prisma.departmentMembership.upsert({
        where: { userId_departmentId: { userId: m.userId, departmentId: department.id } },
        update: { roleInDept: m.roleInDept, skills: serializeSkills(m.skills) },
        create: {
          userId: m.userId,
          departmentId: department.id,
          roleInDept: m.roleInDept,
          skills: serializeSkills(m.skills),
        },
      }),
    ),
  ]);

  await recordAudit({
    actorId: user!.id,
    action: "DEPARTMENT_MEMBERS_CHANGED",
    entityType: "Department",
    entityId: department.id,
    summary: `${department.name} now has ${wanted.length} member(s)`,
  });

  return NextResponse.json({ ok: true });
}
