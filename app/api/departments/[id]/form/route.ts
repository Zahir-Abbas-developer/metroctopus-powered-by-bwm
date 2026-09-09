import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { canUseDepartment } from "@/lib/departments";
import { fieldsFor } from "@/lib/fields";
import { assignableMembers } from "@/lib/assignment";
import { FIELD_ENTITIES, hasAdminPower, type FieldEntity } from "@/lib/constants";

/**
 * Steps 2 and 3 of the creation wizard, for one department.
 *
 * Returns that department's field definitions, its pipeline stages and the
 * people who may be assigned the record — in one call, because the form cannot
 * usefully render any of the three on its own and three round trips would show
 * the user a form assembling itself.
 *
 * `context` is free text describing the work (the chosen category, the service
 * interest) and only affects the *order* of `assignees`, never its membership.
 *
 * Nothing here is filtered in the component: a department the viewer does not
 * belong to answers 403 rather than an empty list, because "you may not ask" and
 * "there is nothing" are different answers and the caller should not conflate
 * them.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);

  const requestedEntity = (searchParams.get("entity") ?? "LEAD").toUpperCase();
  if (!(FIELD_ENTITIES as readonly string[]).includes(requestedEntity)) {
    return apiError("Unknown record type", 400);
  }
  const entity = requestedEntity as FieldEntity;

  const allowed = await canUseDepartment(user.id, hasAdminPower(user.role), params.id);
  if (!allowed) return apiError("That department isn't one of yours", 403);

  const department = await prisma.department.findFirst({
    where: { id: params.id, isActive: true },
    select: { id: true, slug: true, name: true, shortLabel: true, colorToken: true },
  });
  if (!department) return apiError("That department no longer exists", 404);

  const context = (searchParams.get("context") ?? "")
    .split(",")
    .map((term) => term.trim())
    .filter(Boolean)
    .slice(0, 12);

  const [fields, stages, assignees] = await Promise.all([
    fieldsFor(department.id, entity),
    prisma.pipelineStage.findMany({
      where: { departmentId: department.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      select: { key: true, label: true, isWon: true, isLost: true },
    }),
    assignableMembers(department.id, context),
  ]);

  return NextResponse.json({ department, entity, fields, stages, assignees });
}
