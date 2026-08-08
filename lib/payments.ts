import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";

/**
 * Retainer payment tracking.
 *
 * The cycle is the unit that gets invoiced, so payment lives on `Project`
 * rather than on the client — a client can be three months in with two paid
 * and one outstanding, and a single flag on the client cannot say that.
 *
 * MRR without this is a number the owner can't act on: it counts what was
 * *agreed*, not what arrived.
 */

export const PAYMENT_STATUSES = ["PENDING", "PAID", "OVERDUE"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  PENDING: "Awaiting payment",
  PAID: "Paid",
  OVERDUE: "Overdue",
};

export const PAYMENT_TONE: Record<PaymentStatus, "neutral" | "success" | "danger"> = {
  PENDING: "neutral",
  PAID: "success",
  OVERDUE: "danger",
};

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

/**
 * Marks unpaid cycles overdue once they are old enough.
 *
 * Measured from the cycle's **start**, not its end: a retainer is billed up
 * front, so an invoice raised on the 1st being unpaid on the 8th is late even
 * though the month has three weeks to run.
 *
 * Only ever moves PENDING → OVERDUE. A cycle marked PAID stays paid, and one
 * already OVERDUE isn't re-stamped, so the transition happens once.
 */
export async function markOverdueCycles(now = new Date()): Promise<number> {
  const settings = await getSettings();
  const cutoff = new Date(now.getTime() - settings.paymentOverdueDays * 86_400_000);

  const result = await prisma.project.updateMany({
    where: {
      paymentStatus: "PENDING",
      startDate: { lt: cutoff },
      client: { status: { in: ["ACTIVE", "PAUSED"] } },
    },
    data: { paymentStatus: "OVERDUE" },
  });

  return result.count;
}

export type Collections = {
  /** Value of every unpaid cycle, whatever its age. */
  outstanding: number;
  overdue: number;
  /** Retainer value collected for cycles running this month. */
  collectedThisMonth: number;
  outstandingThisMonth: number;
  overdueClients: {
    clientId: string;
    clientName: string;
    projectId: string;
    title: string;
    amount: number;
    daysOverdue: number;
  }[];
};

/**
 * What is owed, and by whom.
 *
 * Amounts come from the client's `monthlyBudget` rather than a stored invoice
 * total — there is no invoicing model here, and inventing one would be a
 * bigger feature pretending to be a smaller one. The figure is what the
 * retainer is worth; a real invoice may differ, which is what `invoiceNote`
 * is for.
 */
export async function collections(now = new Date()): Promise<Collections> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const cycles = await prisma.project.findMany({
    where: { client: { status: { in: ["ACTIVE", "PAUSED"] } } },
    orderBy: { startDate: "desc" },
    include: {
      client: { select: { id: true, businessName: true, monthlyBudget: true } },
    },
  });

  let outstanding = 0;
  let overdue = 0;
  let collectedThisMonth = 0;
  let outstandingThisMonth = 0;
  const overdueClients: Collections["overdueClients"] = [];

  for (const cycle of cycles) {
    const amount = cycle.client.monthlyBudget;
    const thisMonth = cycle.startDate >= monthStart && cycle.startDate < monthEnd;

    if (cycle.paymentStatus === "PAID") {
      if (thisMonth) collectedThisMonth += amount;
      continue;
    }

    outstanding += amount;
    if (thisMonth) outstandingThisMonth += amount;

    if (cycle.paymentStatus === "OVERDUE") {
      overdue += amount;
      overdueClients.push({
        clientId: cycle.client.id,
        clientName: cycle.client.businessName,
        projectId: cycle.id,
        title: cycle.title,
        amount,
        daysOverdue: Math.max(
          0,
          Math.floor((now.getTime() - cycle.startDate.getTime()) / 86_400_000),
        ),
      });
    }
  }

  overdueClients.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return {
    outstanding,
    overdue,
    collectedThisMonth,
    outstandingThisMonth,
    overdueClients,
  };
}

/** Unpaid cycle counts per client, for the health score. */
export async function overdueCyclesByClient(clientIds: readonly string[]) {
  const result = new Map<string, { status: PaymentStatus; overdueCycles: number }>();
  if (clientIds.length === 0) return result;

  const cycles = await prisma.project.findMany({
    where: { clientId: { in: [...clientIds] } },
    orderBy: { startDate: "desc" },
    select: { clientId: true, paymentStatus: true },
  });

  for (const clientId of clientIds) {
    const own = cycles.filter((cycle) => cycle.clientId === clientId);
    result.set(clientId, {
      // The most recent cycle is the one that describes the relationship now.
      status: (own[0]?.paymentStatus as PaymentStatus) ?? "PENDING",
      overdueCycles: own.filter((cycle) => cycle.paymentStatus === "OVERDUE").length,
    });
  }

  return result;
}
