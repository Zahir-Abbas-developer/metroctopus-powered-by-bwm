import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { serializeSkills } from "@/lib/skills";
import { DEPT_ROLES } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";

const schema = z.object({
  memberships: z
    .array(
      z.object({
        departmentId: z.string().min(1),
        roleInDept: z.enum(DEPT_ROLES).default("MEMBER"),
        skills: z.array(z.string().trim().max(40)).max(24).default([]),
      }),
    )
    .max(50),
});

/**
 * One person's departments, from the other direction.
 *
 * Settings → Departments edits a department's roster; this edits a person's
 * memberships. Both write the same rows, and both send a complete list rather
 * than deltas so concurrent edits converge on a state instead of a sequence.
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const target = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!target) return apiError("That person no longer exists", 404);

  const wanted = parsed.data.memberships;
  const departmentIds = wanted.map((m) => m.departmentId);

  // A membership pointing at an inactive department would scope records to a
  // business line that no longer appears anywhere.
  const departments = await prisma.department.findMany({
    where: { id: { in: departmentIds }, isActive: true },
    select: { id: true },
  });
  if (departments.length !== new Set(departmentIds).size) {
    return apiError("One of those departments is no longer available", 422, {
      memberships: "Refresh and pick the departments again",
    });
  }

  await prisma.$transaction([
    prisma.departmentMembership.deleteMany({
      where: {
        userId: target.id,
        departmentId: { notIn: departmentIds.length ? departmentIds : ["_none"] },
      },
    }),
    ...wanted.map((m) =>
      prisma.departmentMembership.upsert({
        where: { userId_departmentId: { userId: target.id, departmentId: m.departmentId } },
        update: { roleInDept: m.roleInDept, skills: serializeSkills(m.skills) },
        create: {
          userId: target.id,
          departmentId: m.departmentId,
          roleInDept: m.roleInDept,
          skills: serializeSkills(m.skills),
        },
      }),
    ),
  ]);

  await recordAudit({
    actorId: user!.id,
    action: "DEPARTMENT_MEMBERS_CHANGED",
    entityType: "User",
    entityId: target.id,
    summary: `${target.name} now belongs to ${wanted.length} department(s)`,
  });

  return NextResponse.json({ ok: true });
}
