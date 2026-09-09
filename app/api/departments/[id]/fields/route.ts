import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { allFieldsFor, serializeOptions, toFieldKey, typeTakesOptions } from "@/lib/fields";
import { FIELD_ENTITIES, FIELD_TYPES, type FieldEntity } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";

/**
 * A department's field definitions for one entity.
 *
 * Like the membership route, a write replaces the whole list rather than
 * applying add/remove deltas: two admins editing the same department converge on
 * a list instead of on a half-applied set of operations, and the order is simply
 * the order of the array.
 */

const fieldSchema = z.object({
  /** Absent on a field being added. */
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1, "Give the field a label").max(80),
  type: z.enum(FIELD_TYPES),
  options: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
  helpText: z.string().trim().max(200).nullish(),
  required: z.boolean().default(false),
  isActive: z.boolean().default(true),
  showIfKey: z.string().trim().max(60).nullish(),
  showIfValues: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
});

const bodySchema = z.object({
  entity: z.enum(FIELD_ENTITIES),
  fields: z.array(fieldSchema).max(60),
});

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const requested = (searchParams.get("entity") ?? "CLIENT").toUpperCase();
  if (!(FIELD_ENTITIES as readonly string[]).includes(requested)) {
    return apiError("Unknown record type", 400);
  }

  return NextResponse.json({
    fields: await allFieldsFor(params.id, requested as FieldEntity),
  });
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const { user, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const department = await prisma.department.findUnique({
    where: { id: params.id },
    select: { id: true, name: true },
  });
  if (!department) return apiError("That department no longer exists", 404);

  const { entity, fields } = parsed.data;

  // Keys are derived from labels and must be unique per department and entity —
  // they are what `showIfKey` points at and what `FieldValue` is read back by.
  const existing = await allFieldsFor(department.id, entity);
  const keyById = new Map(existing.map((f) => [f.id, f.key]));

  const keys: string[] = [];
  for (const field of fields) {
    // An existing field keeps its key even when relabelled: rewriting it would
    // orphan every answer already recorded against it.
    const key = (field.id && keyById.get(field.id)) || toFieldKey(field.label);
    if (!key) {
      return apiError("Please fix the highlighted fields", 422, {
        fields: `"${field.label}" doesn't produce a usable field key`,
      });
    }
    keys.push(key);
  }

  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) {
    return apiError("Please fix the highlighted fields", 422, {
      fields: `Two fields resolve to the same key ("${duplicate}") — rename one`,
    });
  }

  // A condition pointing at a field that is not in this list would hide its
  // dependent field forever; `lib/fields.ts` treats an unresolvable rule as
  // "not visible", so the error belongs here where it can still be fixed.
  for (const field of fields) {
    if (!field.showIfKey) continue;
    if (!keys.includes(field.showIfKey)) {
      return apiError("Please fix the highlighted fields", 422, {
        fields: `"${field.label}" depends on a field that isn't in this list`,
      });
    }
  }

  const removedIds = existing
    .filter((row) => !fields.some((field) => field.id === row.id))
    .map((row) => row.id);

  await prisma.$transaction([
    // Answers go with the definition — a FieldValue whose definition is gone is
    // unreadable, since the definition is what says how to parse it.
    prisma.fieldValue.deleteMany({
      where: { fieldDefinitionId: { in: removedIds.length ? removedIds : ["_none"] } },
    }),
    prisma.fieldDefinition.deleteMany({
      where: { id: { in: removedIds.length ? removedIds : ["_none"] } },
    }),
    ...fields.map((field, index) => {
      const key = keys[index];
      const shape = {
        label: field.label,
        type: field.type,
        options: typeTakesOptions(field.type) ? serializeOptions(field.options) : "",
        helpText: field.helpText?.trim() || null,
        required: field.required,
        order: index + 1,
        isActive: field.isActive,
        showIfKey: field.showIfKey?.trim() || null,
        showIfValues: field.showIfKey ? serializeOptions(field.showIfValues) : "",
      };

      return prisma.fieldDefinition.upsert({
        where: {
          departmentId_entity_key: { departmentId: department.id, entity, key },
        },
        update: shape,
        create: { departmentId: department.id, entity, key, ...shape },
      });
    }),
  ]);

  await recordAudit({
    actorId: user!.id,
    action: "DEPARTMENT_FIELDS_CHANGED",
    entityType: "Department",
    entityId: department.id,
    summary: `${department.name} ${entity.toLowerCase()} fields updated — ${fields.length} field(s)`,
  });

  return NextResponse.json({ fields: await allFieldsFor(department.id, entity) });
}
