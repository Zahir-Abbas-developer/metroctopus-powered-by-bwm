import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { deriveWeek, roasAlert, summarise, trend, weekStartOf, type KpiWeek } from "@/lib/kpi";

/**
 * Client commercial numbers: reading, writing, and the alert that saves a
 * retainer.
 *
 * All the arithmetic lives in lib/kpi.ts. This only fetches rows and decides
 * who to tell.
 */

export type ClientKpis = {
  targetRoas: number;
  weeks: (KpiWeek & { id: string; notes: string | null; enteredBy: string | null })[];
  latest: KpiWeek | null;
  previous: KpiWeek | null;
  trends: {
    roas: ReturnType<typeof trend>;
    revenue: ReturnType<typeof trend>;
    spend: ReturnType<typeof trend>;
    orders: ReturnType<typeof trend>;
  };
  summary: ReturnType<typeof summarise>;
  alert: ReturnType<typeof roasAlert>;
};

/** A client's recent weeks, oldest first, with everything derived. */
export async function kpisForClient(clientId: string, weeks = 12): Promise<ClientKpis> {
  const settings = await getSettings();

  const [client, rows] = await Promise.all([
    prisma.client.findUnique({ where: { id: clientId }, select: { targetRoas: true } }),
    prisma.clientKpiEntry.findMany({
      where: { clientId },
      orderBy: { weekStart: "desc" },
      take: weeks,
      include: { enteredBy: { select: { name: true } } },
    }),
  ]);

  const targetRoas = client?.targetRoas ?? settings.defaultTargetRoas;

  // Oldest first, so a chart reads left to right and the alert counts
  // backwards from the end.
  const ordered = [...rows].reverse();

  const derived = ordered.map((row) => ({
    ...deriveWeek({
      weekStart: row.weekStart,
      googleSpend: row.googleSpend,
      metaSpend: row.metaSpend,
      revenue: row.revenue,
      orders: row.orders,
      storeSessions: row.storeSessions,
    }),
    id: row.id,
    notes: row.notes,
    enteredBy: row.enteredBy?.name ?? null,
  }));

  const latest = derived.at(-1) ?? null;
  const previous = derived.at(-2) ?? null;

  return {
    targetRoas,
    weeks: derived,
    latest,
    previous,
    trends: {
      roas: trend(latest?.roas ?? null, previous?.roas ?? null),
      revenue: trend(latest?.revenue ?? null, previous?.revenue ?? null),
      spend: trend(latest?.spend ?? null, previous?.spend ?? null),
      orders: trend(latest?.orders ?? null, previous?.orders ?? null),
    },
    summary: summarise(derived),
    alert: roasAlert(derived, targetRoas, settings.roasAlertWeeks),
  };
}

export type SaveKpiResult =
  | { ok: true; id: string; alertFired: boolean }
  | { ok: false; reason: string; field?: string };

/**
 * Records one week.
 *
 * Upsert on (client, week): whoever runs the ads is entering these on a phone
 * between other things, and the common correction is "I typed Monday's revenue
 * before the weekend orders settled". A second submission for the same week
 * replaces the first rather than creating a duplicate the charts then average.
 */
export async function saveKpiWeek(options: {
  clientId: string;
  weekStart: Date;
  googleSpend: number;
  metaSpend: number;
  revenue: number;
  orders: number;
  storeSessions: number;
  notes?: string | null;
  enteredById: string;
  now?: Date;
}): Promise<SaveKpiResult> {
  const now = options.now ?? new Date();
  const weekStart = weekStartOf(options.weekStart);

  if (weekStart > weekStartOf(now)) {
    return {
      ok: false,
      reason: "That week hasn't happened yet.",
      field: "weekStart",
    };
  }

  const client = await prisma.client.findUnique({
    where: { id: options.clientId },
    select: { id: true },
  });
  if (!client) return { ok: false, reason: "That client no longer exists." };

  const entry = await prisma.clientKpiEntry.upsert({
    where: { clientId_weekStart: { clientId: options.clientId, weekStart } },
    update: {
      googleSpend: options.googleSpend,
      metaSpend: options.metaSpend,
      revenue: options.revenue,
      orders: options.orders,
      storeSessions: options.storeSessions,
      notes: options.notes ?? null,
      enteredById: options.enteredById,
    },
    create: {
      clientId: options.clientId,
      weekStart,
      googleSpend: options.googleSpend,
      metaSpend: options.metaSpend,
      revenue: options.revenue,
      orders: options.orders,
      storeSessions: options.storeSessions,
      notes: options.notes ?? null,
      enteredById: options.enteredById,
    },
  });

  const alertFired = await checkRoasAlert(options.clientId, now);

  return { ok: true, id: entry.id, alertFired };
}

/**
 * Fires the performance alert if the streak has reached its threshold.
 *
 * Deduped per client per week, so re-saving the same week doesn't re-notify,
 * and a streak that runs for a month produces one notice a week rather than
 * one per keystroke.
 *
 * Told to the owner *and* whoever runs that client's ads. An alert that only
 * reaches the owner turns into the owner relaying it, which is the manual
 * chasing this whole product exists to remove.
 */
export async function checkRoasAlert(clientId: string, now = new Date()): Promise<boolean> {
  const kpis = await kpisForClient(clientId, 12);
  if (!kpis.alert.firing) return false;

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: { id: true, businessName: true },
  });
  if (!client) return false;

  const week = kpis.latest?.weekStart.toISOString().slice(0, 10) ?? "unknown";

  const [owners, marketers] = await Promise.all([
    prisma.user.findMany({
      where: { role: "ADMIN", isActive: true },
      select: { id: true },
    }),
    // Whoever is carrying live work on this client's ad workstreams.
    prisma.user.findMany({
      where: {
        isActive: true,
        milestones: {
          some: {
            status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED", "SUBMITTED"] },
            module: {
              project: { clientId },
              service: { slug: { in: ["google-ads-management", "meta-ads-management", "full-funnel"] } },
            },
          },
        },
      },
      select: { id: true },
    }),
  ]);

  const recipients = new Set([...owners, ...marketers].map((person) => person.id));

  for (const userId of recipients) {
    await notify({
      userId,
      type: "OVERDUE",
      title: `${client.businessName} is under target`,
      body: `ROAS ${kpis.alert.latestRoas ?? "—"} against a ${kpis.alert.target} target, ${
        kpis.alert.weeksBelow
      } weeks running. Worth a conversation before they start one.`,
      href: `/clients/${clientId}`,
      dedupeKey: `roas-alert:${clientId}:${week}:${userId}`,
    });
  }

  return true;
}

/** Live alert state for a set of clients, for the cards and the health score. */
export async function alertsForClients(clientIds: readonly string[]) {
  const settings = await getSettings();
  if (clientIds.length === 0) return new Map<string, ReturnType<typeof roasAlert>>();

  const [clients, rows] = await Promise.all([
    prisma.client.findMany({
      where: { id: { in: [...clientIds] } },
      select: { id: true, targetRoas: true },
    }),
    prisma.clientKpiEntry.findMany({
      where: { clientId: { in: [...clientIds] } },
      orderBy: { weekStart: "asc" },
      select: {
        clientId: true,
        googleSpend: true,
        metaSpend: true,
        revenue: true,
        weekStart: true,
      },
    }),
  ]);

  const byClient = new Map<string, { roas: number | null }[]>();
  for (const row of rows) {
    const spend = row.googleSpend + row.metaSpend;
    const list = byClient.get(row.clientId) ?? [];
    // Rounded to two places, exactly as deriveWeek does. The same ROAS reaches
    // a chart through one path and a health headline through this one, and a
    // client reading "2.17" on screen while the score says 2.1699471915506483
    // is one number pretending to be two.
    list.push({ roas: spend > 0 ? Math.round((row.revenue / spend) * 100) / 100 : null });
    byClient.set(row.clientId, list);
  }

  const result = new Map<string, ReturnType<typeof roasAlert>>();
  for (const client of clients) {
    result.set(
      client.id,
      roasAlert(
        byClient.get(client.id) ?? [],
        client.targetRoas ?? settings.defaultTargetRoas,
        settings.roasAlertWeeks,
      ),
    );
  }

  return result;
}
