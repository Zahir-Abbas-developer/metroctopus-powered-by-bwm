import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { requireAdminApi } from "@/lib/api";
import { AUDIT_ACTIONS } from "@/lib/audit";

/**
 * The audit log.
 *
 * Owner-only, deliberately. A log of who exercised authority over whom is a
 * different thing from a team activity feed, and making it visible to everyone
 * would turn every judgement call into a performance.
 */
export async function GET(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const actorId = searchParams.get("actorId");
  const asLead = searchParams.get("asLead");
  const take = Math.min(200, Math.max(10, Number(searchParams.get("take") ?? "100")));

  const entries = await prisma.auditLog.findMany({
    where: {
      ...(action && action !== "ALL" && (AUDIT_ACTIONS as readonly string[]).includes(action)
        ? { action }
        : {}),
      ...(actorId && actorId !== "ALL" ? { actorId } : {}),
      ...(asLead === "1" ? { asLead: true } : {}),
    },
    orderBy: { createdAt: "desc" },
    take,
    include: { actor: { select: { id: true, name: true, avatarColor: true, role: true } } },
  });

  const actors = await prisma.user.findMany({
    where: { auditEntries: { some: {} } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return NextResponse.json({
    actors,
    entries: entries.map((entry) => ({
      id: entry.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      summary: entry.summary,
      asLead: entry.asLead,
      createdAt: entry.createdAt.toISOString(),
      actor: entry.actor,
      before: entry.beforeJson ? (JSON.parse(entry.beforeJson) as Record<string, unknown>) : null,
      after: entry.afterJson ? (JSON.parse(entry.afterJson) as Record<string, unknown>) : null,
    })),
  });
}
