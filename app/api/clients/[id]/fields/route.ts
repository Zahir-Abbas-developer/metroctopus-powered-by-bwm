import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import {
  displayValue,
  fieldsFor,
  validateFieldValues,
  valuesFor,
  writeFieldValues,
} from "@/lib/fields";
import { recordAudit } from "@/lib/audit";

/**
 * One client's department-specific answers.
 *
 * A sub-route rather than more keys on the client PATCH: these values live in
 * their own table, are validated against definitions the client body knows
 * nothing about, and belong to whichever department the record is in. Keeping
 * them separate means the core client update cannot accidentally drop them, and
 * this route cannot accidentally change a core column.
 */

const bodySchema = z.object({
  values: z.record(z.string(), z.string()),
});

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, departmentId: true },
  });
  if (!client) return apiError("That client no longer exists", 404);

  const definitions = await fieldsFor(client.departmentId, "CLIENT");
  const values = await valuesFor(client.id, definitions);

  return NextResponse.json({ fields: definitions, values });
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
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
    return apiError("Invalid request body", 422);
  }

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, businessName: true, departmentId: true },
  });
  if (!client) return apiError("That client no longer exists", 404);

  const definitions = await fieldsFor(client.departmentId, "CLIENT");

  // A payload naming another department's field key simply has no definition to
  // match, so it is ignored rather than trusted — but a *wrong* answer to a real
  // field is a 422 the editor can show against the input.
  const problems = validateFieldValues(definitions, parsed.data.values);
  if (problems.length > 0) {
    return apiError(
      "Please fix the highlighted fields",
      422,
      Object.fromEntries(problems.map((problem) => [problem.key, problem.message])),
    );
  }

  const before = await valuesFor(client.id, definitions);
  await writeFieldValues(client.id, definitions, parsed.data.values);
  const after = await valuesFor(client.id, definitions);

  // Audit what actually changed, by label — an entry saying "fields updated"
  // tells whoever reads the log later nothing they can act on.
  const changed = definitions.filter(
    (definition) => (before[definition.key] ?? "") !== (after[definition.key] ?? ""),
  );

  if (changed.length > 0) {
    // The audit log answers "who changed what" for an admin; the timeline
    // answers "what has happened to this client" for whoever picks it up next.
    // Both are worth having, and only one of them is on the record's own page.
    await prisma.salesActivity.create({
      data: {
        departmentId: client.departmentId,
        clientId: client.id,
        userId: user!.id,
        type: "NOTE",
        isSystem: true,
        note: `Updated ${changed.map((definition) => definition.label).join(", ")}`,
      },
    });

    await recordAudit({
      actorId: user!.id,
      action: "CLIENT_FIELDS_CHANGED",
      entityType: "Client",
      entityId: client.id,
      summary: `${client.businessName}: ${changed
        .map(
          (definition) =>
            `${definition.label} → ${displayValue(definition, after[definition.key]) || "cleared"}`,
        )
        .join(", ")}`,
    });
  }

  return NextResponse.json({ fields: definitions, values: after });
}
