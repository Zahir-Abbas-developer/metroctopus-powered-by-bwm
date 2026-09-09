import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { stagesFor } from "@/lib/stages";
import { toFieldKey } from "@/lib/fields";
import { DEPARTMENT_COLOR_TOKENS, STAGE_KINDS } from "@/lib/constants";
import { recordAudit } from "@/lib/audit";

/**
 * A department's pipeline stages.
 *
 * Whole-list replace, like fields and members: the order of the array is the
 * order of the board, and two admins editing at once converge on a list rather
 * than on a half-applied set of moves.
 *
 * The rule that makes this more than a list editor: **a stage holding records
 * cannot simply vanish.** Removing or deactivating one requires naming where
 * its records go, and they are moved in the same transaction. A department
 * whose board silently stops showing four deals is worse than a refused edit.
 */

const stageSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().trim().min(1, "Give the stage a label").max(60),
  kind: z.enum(STAGE_KINDS),
  colorToken: z.enum(DEPARTMENT_COLOR_TOKENS).nullish(),
  isActive: z.boolean().default(true),
});

const bodySchema = z.object({
  stages: z.array(stageSchema).min(1, "A pipeline needs at least one stage").max(30),
  /**
   * Where records go when their stage is removed or switched off, keyed by the
   * id of the stage being retired.
   */
  moveTo: z.record(z.string(), z.string()).default({}),
});

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;

  return NextResponse.json({ stages: await stagesFor(params.id, true) });
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

  const existing = await stagesFor(department.id, true);
  const keyById = new Map(existing.map((stage) => [stage.id, stage.key]));

  const { stages, moveTo } = parsed.data;

  // An existing stage keeps its key when relabelled: the key is what every
  // Lead.stage column holds, so rewriting it would strand every record on it.
  const keys = stages.map(
    (stage) => (stage.id && keyById.get(stage.id)) || toFieldKey(stage.label).toUpperCase(),
  );

  const blank = keys.findIndex((key) => !key);
  if (blank >= 0) {
    return apiError("Please fix the highlighted fields", 422, {
      stages: `"${stages[blank].label}" doesn't produce a usable stage key`,
    });
  }

  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) {
    return apiError("Please fix the highlighted fields", 422, {
      stages: `Two stages resolve to the same key ("${duplicate}") — rename one`,
    });
  }

  if (!stages.some((stage) => stage.isActive)) {
    return apiError("Please fix the highlighted fields", 422, {
      stages: "At least one stage has to stay active, or the board has no columns",
    });
  }

  // Which stages are going away, either removed outright or switched off.
  const retiring = existing.filter((stage) => {
    const kept = stages.find((row) => row.id === stage.id);
    return !kept || (stage.isActive && !kept.isActive);
  });

  const counts = new Map<string, number>();
  for (const stage of retiring) {
    counts.set(
      stage.id,
      await prisma.lead.count({ where: { departmentId: department.id, stage: stage.key } }),
    );
  }

  const survivingKeys = new Set(
    keys.filter((_, index) => stages[index].isActive),
  );

  for (const stage of retiring) {
    const held = counts.get(stage.id) ?? 0;
    if (held === 0) continue;

    const destinationId = moveTo[stage.id];
    const destinationIndex = stages.findIndex((row) => row.id === destinationId);
    const destinationKey = destinationIndex >= 0 ? keys[destinationIndex] : undefined;

    if (!destinationKey || !survivingKeys.has(destinationKey)) {
      return apiError(
        `"${stage.label}" still holds ${held} record${held === 1 ? "" : "s"}`,
        409,
        {
          stages: `Choose where the ${held} record${held === 1 ? "" : "s"} in "${stage.label}" should go`,
        },
      );
    }
  }

  const writes = [
    ...retiring
      .filter((stage) => (counts.get(stage.id) ?? 0) > 0)
      .map((stage) => {
        const index = stages.findIndex((row) => row.id === moveTo[stage.id]);
        return prisma.lead.updateMany({
          where: { departmentId: department.id, stage: stage.key },
          data: { stage: keys[index], stageChangedAt: new Date() },
        });
      }),
    ...existing
      .filter((stage) => !stages.some((row) => row.id === stage.id))
      .map((stage) => prisma.pipelineStage.delete({ where: { id: stage.id } })),
    ...stages.map((stage, index) =>
      prisma.pipelineStage.upsert({
        where: { departmentId_key: { departmentId: department.id, key: keys[index] } },
        update: {
          label: stage.label,
          kind: stage.kind,
          colorToken: stage.colorToken ?? null,
          sortOrder: index + 1,
          isActive: stage.isActive,
        },
        create: {
          departmentId: department.id,
          key: keys[index],
          label: stage.label,
          kind: stage.kind,
          colorToken: stage.colorToken ?? null,
          sortOrder: index + 1,
          isActive: stage.isActive,
        },
      }),
    ),
  ];

  await prisma.$transaction(writes);

  await recordAudit({
    actorId: user!.id,
    action: "DEPARTMENT_STAGES_CHANGED",
    entityType: "Department",
    entityId: department.id,
    summary: `${department.name} pipeline updated — ${stages.length} stage(s)`,
  });

  return NextResponse.json({ stages: await stagesFor(department.id, true) });
}
