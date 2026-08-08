import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { kpisForClient, saveKpiWeek } from "@/lib/kpi-service";

const entrySchema = z.object({
  /** Any date in the week; the service normalises it to the Monday. */
  weekStart: z.string().min(8),
  googleSpend: z.number().int().min(0).max(10_000_000).default(0),
  metaSpend: z.number().int().min(0).max(10_000_000).default(0),
  revenue: z.number().int().min(0).max(100_000_000).default(0),
  orders: z.number().int().min(0).max(1_000_000).default(0),
  storeSessions: z.number().int().min(0).max(100_000_000).default(0),
  notes: z.string().trim().max(1000).nullish(),
});

/**
 * A client's weekly numbers.
 *
 * Readable by anyone signed in: the marketer running the campaigns needs to
 * see whether their work is making money, and hiding it behind the owner turns
 * every performance question into a request.
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const weeks = Math.min(52, Math.max(4, Number(searchParams.get("weeks") ?? "12")));

  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { id: true, businessName: true, targetRoas: true },
  });
  if (!client) return apiError("That client no longer exists", 404);

  const kpis = await kpisForClient(client.id, weeks);

  return NextResponse.json({
    client,
    targetRoas: kpis.targetRoas,
    alert: kpis.alert,
    trends: kpis.trends,
    summary: kpis.summary,
    weeks: kpis.weeks.map((week) => ({
      id: week.id,
      weekStart: week.weekStart.toISOString(),
      googleSpend: week.googleSpend,
      metaSpend: week.metaSpend,
      spend: week.spend,
      revenue: week.revenue,
      orders: week.orders,
      storeSessions: week.storeSessions,
      roas: week.roas,
      conversionRate: week.conversionRate,
      averageOrderValue: week.averageOrderValue,
      costPerOrder: week.costPerOrder,
      notes: week.notes,
      enteredBy: week.enteredBy,
    })),
  });
}

/**
 * Records a week.
 *
 * Any signed-in member can log — whoever runs the ads is the person with the
 * numbers, and routing it through the owner guarantees the data is a week
 * stale or missing entirely.
 */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = entrySchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const weekStart = new Date(parsed.data.weekStart);
  if (Number.isNaN(weekStart.getTime())) {
    return apiError("That week didn't parse", 422, { weekStart: "Invalid date" });
  }

  const result = await saveKpiWeek({
    clientId: params.id,
    weekStart,
    googleSpend: parsed.data.googleSpend,
    metaSpend: parsed.data.metaSpend,
    revenue: parsed.data.revenue,
    orders: parsed.data.orders,
    storeSessions: parsed.data.storeSessions,
    notes: parsed.data.notes ?? null,
    enteredById: user.id,
  });

  if (!result.ok) {
    return apiError(
      result.reason,
      422,
      result.field ? { [result.field]: result.reason } : undefined,
    );
  }

  return NextResponse.json(result, { status: 201 });
}

/** Removing a week is the owner's call — the charts and alerts read from it. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let entryId: string | null = null;
  try {
    entryId = ((await request.json()) as { entryId?: string })?.entryId ?? null;
  } catch {
    // Handled below.
  }
  if (!entryId) return apiError("Which week?", 422, { entryId: "Required" });

  const entry = await prisma.clientKpiEntry.findUnique({
    where: { id: entryId },
    select: { clientId: true },
  });
  if (!entry || entry.clientId !== params.id) {
    return apiError("That entry no longer exists", 404);
  }

  await prisma.clientKpiEntry.delete({ where: { id: entryId } });
  return NextResponse.json({ ok: true });
}
