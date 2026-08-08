import { prisma } from "@/lib/prisma";
import type { Actor } from "@/lib/permissions";

/**
 * The database side of delegation: who leads what, and who is in whose pod.
 *
 * All the judgement is in lib/permissions.ts. This only looks things up.
 */

const LIVE_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "SUBMITTED"];

/** The signed-in user as the permission functions want them. */
export async function actorFor(user: {
  id: string;
  role: string;
}): Promise<Actor> {
  const leads = await prisma.serviceLead.findMany({
    where: { userId: user.id },
    select: { serviceId: true },
  });

  return {
    id: user.id,
    role: user.role === "ADMIN" ? "ADMIN" : "MEMBER",
    leadServiceIds: leads.map((lead) => lead.serviceId),
  };
}

/**
 * A lead's pod: whoever is currently carrying work in their service lines.
 *
 * Computed from live assignments rather than stored, because a team of five
 * shuffles constantly and a stored pod would be wrong within a fortnight. The
 * cost is one query; the alternative is a membership table nobody maintains.
 *
 * Deliberately excludes the lead themselves — every permission check refuses
 * self-action anyway, and leaving them out keeps the pod list honest as a
 * "people you are responsible for" list.
 */
export async function podMemberIds(actor: Actor): Promise<string[]> {
  if (actor.leadServiceIds.length === 0) return [];

  const milestones = await prisma.milestone.findMany({
    where: {
      status: { in: LIVE_STATUSES },
      assigneeId: { not: null },
      module: { serviceId: { in: [...actor.leadServiceIds] } },
    },
    select: { assigneeId: true },
    distinct: ["assigneeId"],
  });

  return milestones
    .map((milestone) => milestone.assigneeId!)
    .filter((id) => id !== actor.id);
}

/** The service a milestone's module belongs to, for a scope check. */
export async function serviceIdForMilestone(milestoneId: string): Promise<string | null> {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { module: { select: { serviceId: true } } },
  });
  return milestone?.module.serviceId ?? null;
}

/** Who leads each of a set of services. */
export async function leadsByService(serviceIds: readonly string[]) {
  const rows = await prisma.serviceLead.findMany({
    where: { serviceId: { in: [...serviceIds] } },
    include: { user: { select: { id: true, name: true, isActive: true } } },
  });

  const map = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    if (!row.user.isActive) continue;
    map.set(row.serviceId, [
      ...(map.get(row.serviceId) ?? []),
      { id: row.user.id, name: row.user.name },
    ]);
  }
  return map;
}

export async function adminIds(): Promise<string[]> {
  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
  return admins.map((admin) => admin.id);
}

/** Every lead assignment, for the team page and the settings panel. */
export async function allServiceLeads() {
  const rows = await prisma.serviceLead.findMany({
    include: {
      user: { select: { id: true, name: true, avatarColor: true, isActive: true } },
      service: { select: { id: true, name: true, slug: true } },
    },
    orderBy: [{ service: { order: "asc" } }],
  });

  return rows.map((row) => ({
    userId: row.userId,
    serviceId: row.serviceId,
    user: row.user,
    service: row.service,
  }));
}
