import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { MODULES, getModuleFlags, type ModuleKey } from "@/lib/modules";
import { recordAudit } from "@/lib/audit";

const patchSchema = z.object({
  key: z.enum(MODULES.map((m) => m.key) as [ModuleKey, ...ModuleKey[]]),
  enabled: z.boolean(),
});

export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  return NextResponse.json({
    flags: await getModuleFlags(),
    modules: MODULES.map((m) => ({
      key: m.key,
      label: m.label,
      description: m.description,
    })),
  });
}

export async function PATCH(request: Request) {
  const { user, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return apiError("Unknown module", 422);

  const mod = MODULES.find((m) => m.key === parsed.data.key)!;
  await prisma.settings.upsert({
    where: { id: "singleton" },
    update: { [mod.field]: parsed.data.enabled },
    create: { id: "singleton", [mod.field]: parsed.data.enabled },
  });

  await recordAudit({
    actorId: user!.id,
    action: "MODULE_TOGGLED",
    entityType: "Settings",
    entityId: "singleton",
    summary: `${mod.label} switched ${parsed.data.enabled ? "on" : "off"}`,
  });

  return NextResponse.json({ flags: await getModuleFlags() });
}
