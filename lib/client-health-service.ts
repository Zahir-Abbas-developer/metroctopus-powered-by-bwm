import { prisma } from "@/lib/prisma";
import { dueDeadline } from "@/lib/date";
import { getSettings, healthWeightsFrom } from "@/lib/settings";
import { effectiveDeadline } from "@/lib/scoring";
import { clientHealth, type ClientHealth } from "@/lib/clientHealth";
import { alertsForClients } from "@/lib/kpi-service";
import { overdueCyclesByClient } from "@/lib/payments";

/**
 * The database side of client health.
 *
 * All the judgement is in lib/clientHealth.ts. This gathers the four inputs
 * and hands them over.
 *
 * Batched deliberately: every client card carries a health dot, so a per-card
 * computation would be five clients × four queries on a page load. Everything
 * here takes a list.
 */

export type ClientHealthRow = ClientHealth & {
  clientId: string;
  clientName: string;
};

export async function healthForClients(
  clientIds: readonly string[],
  now = new Date(),
): Promise<Map<string, ClientHealthRow>> {
  const result = new Map<string, ClientHealthRow>();
  if (clientIds.length === 0) return result;

  const settings = await getSettings();
  const weights = healthWeightsFrom(settings);

  const [clients, milestones, blocks, alerts, payments] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: [...clientIds] } },
      select: { id: true, businessName: true, targetRoas: true },
    }),
    // Delivery, on the Phase 8 submission basis and against the blocked-
    // adjusted deadline — the same rule the members' own scores use, so a
    // client's delivery number and a member's cannot tell different stories.
    prisma.milestone.findMany({
      where: {
        module: { project: { clientId: { in: [...clientIds] } } },
        OR: [{ submittedAt: { not: null } }, { status: "MISSED" }],
      },
      select: {
        dueDate: true,
        submittedAt: true,
        blockedMinutes: true,
        module: { select: { project: { select: { clientId: true } } } },
      },
    }),
    prisma.blockPeriod.findMany({
      where: {
        reason: "CLIENT",
        vetoed: false,
        milestone: { module: { project: { clientId: { in: [...clientIds] } } } },
      },
      select: {
        minutes: true,
        startedAt: true,
        endedAt: true,
        milestone: { select: { module: { select: { project: { select: { clientId: true } } } } } },
      },
    }),
    alertsForClients(clientIds),
    overdueCyclesByClient(clientIds),
  ]);

  for (const client of clients) {
    const own = milestones.filter(
      (milestone) => milestone.module.project.clientId === client.id,
    );

    const judged = own.length;
    const onTime = own.filter(
      (milestone) =>
        milestone.submittedAt !== null &&
        milestone.submittedAt <=
          effectiveDeadline(dueDeadline(milestone.dueDate), milestone.blockedMinutes),
    ).length;

    const blockedMinutes = blocks
      .filter((period) => period.milestone.module.project.clientId === client.id)
      .reduce(
        (sum, period) =>
          sum +
          (period.endedAt
            ? (period.minutes ?? 0)
            : Math.max(0, Math.floor((now.getTime() - period.startedAt.getTime()) / 60_000))),
        0,
      );

    const alert = alerts.get(client.id);
    const payment = payments.get(client.id) ?? { status: "PENDING" as const, overdueCycles: 0 };

    const health = clientHealth(
      {
        onTimeRate: judged === 0 ? null : Math.round((onTime / judged) * 100),
        deliveredCount: judged,
        roas: alert?.latestRoas ?? null,
        targetRoas: client.targetRoas ?? settings.defaultTargetRoas,
        weeksBelowTarget: alert?.weeksBelow ?? 0,
        paymentStatus: payment.status,
        overdueCycles: payment.overdueCycles,
        clientBlockedDays: Math.round((blockedMinutes / (60 * 24)) * 10) / 10,
      },
      weights,
    );

    result.set(client.id, {
      ...health,
      clientId: client.id,
      clientName: client.businessName,
    });
  }

  return result;
}

/** Everyone worth worrying about, worst first. */
export async function clientsAtRisk(now = new Date(), limit = 5) {
  const clients = await prisma.client.findMany({
    where: { status: { in: ["ACTIVE", "PAUSED"] } },
    select: { id: true },
  });

  const health = await healthForClients(
    clients.map((client) => client.id),
    now,
  );

  return [...health.values()]
    .filter((row) => row.band !== "HEALTHY")
    .sort((a, b) => a.score - b.score)
    .slice(0, limit);
}
