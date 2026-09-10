import { prisma } from "@/lib/prisma";
import type { Viewer } from "@/lib/visibility";
import { hasAdminPower } from "@/lib/constants";
import { departmentIdsForUser } from "@/lib/departments";

/**
 * Turns a signed-in user into the `Viewer` the visibility matrix takes.
 *
 * Everything the matrix needs is resolved here, per request, from the
 * database — never from the session. A session is a cookie the client holds;
 * promoting someone to service lead, or taking it away, has to take effect on
 * the next request rather than the next time they sign in. That matters most
 * in the direction nobody tests: revoking.
 *
 * SERVICE_LEAD is not a database role. It is a MEMBER with `ServiceLead` rows,
 * so it is derived here and nowhere else.
 */
export async function viewerFor(user: { id: string; role: string }): Promise<Viewer> {
  const isAdmin = hasAdminPower(user.role);

  const [account, leads, assignments, pod, departmentIds] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { isBusinessDev: true },
    }),
    prisma.serviceLead.findMany({
      where: { userId: user.id },
      select: { serviceId: true },
    }),
    // Clients this person has work on — the scope for briefs and ad KPIs.
    prisma.milestone.findMany({
      where: { assigneeId: user.id },
      select: { module: { select: { project: { select: { clientId: true } } } } },
      distinct: ["moduleId"],
    }),
    prisma.serviceLead.findMany({
      where: { userId: user.id },
      select: { serviceId: true },
    }),
    // Doctrine 2, resolved once per request. Read from the database rather than
    // the session for the same reason as everything else here: removing someone
    // from a department has to take effect on the next request, not the next
    // time they sign in.
    departmentIdsForUser(user.id, isAdmin),
  ]);

  const leadServiceIds = leads.map((lead) => lead.serviceId);

  const assignedClientIds = [
    ...new Set(assignments.map((row) => row.module.project.clientId)),
  ];

  /* The pod: whoever is currently carrying work in this person's service
     lines. Computed rather than stored, which means it moves when work is
     reassigned — that is the intended meaning of "their pod", but it does make
     a reassignment a visibility change, so it is resolved in one place where
     that behaviour can be seen. */
  let podMemberIds: string[] = [];
  if (pod.length > 0) {
    const podRows = await prisma.milestone.findMany({
      where: {
        assigneeId: { not: null },
        module: { serviceId: { in: leadServiceIds } },
      },
      select: { assigneeId: true },
      distinct: ["assigneeId"],
    });
    podMemberIds = podRows
      .map((row) => row.assigneeId)
      .filter((id): id is string => Boolean(id));
  }

  return {
    id: user.id,
    role:
      hasAdminPower(user.role)
        ? "ADMIN"
        : leadServiceIds.length > 0
          ? "SERVICE_LEAD"
          : "MEMBER",
    leadServiceIds,
    isBusinessDev: account?.isBusinessDev ?? false,
    assignedClientIds,
    podMemberIds,
    departmentIds,
  };
}
