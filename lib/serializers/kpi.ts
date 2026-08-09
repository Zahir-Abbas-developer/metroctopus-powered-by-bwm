import type { Viewer } from "@/lib/visibility";
import { canSeeClientKpis } from "@/lib/visibility";

/**
 * Client ad performance — spend, revenue, ROAS.
 *
 * These are operational numbers, so they follow the work rather than the
 * money rule: a lead sees the clients their service lines touch, a member sees
 * the clients they are assigned to. Someone running a campaign has to be able
 * to measure it, which is exactly the distinction the matrix draws between ad
 * spend and what the client pays the agency.
 */

export type KpiSource = {
  id: string;
  clientId: string;
  weekStart: Date | string;
  adSpend: number;
  revenue: number;
  roas: number | null;
  conversions: number | null;
  [key: string]: unknown;
};

export type SerializedKpi = Omit<KpiSource, "weekStart"> & { weekStart: string };

const iso = (value: Date | string): string =>
  typeof value === "string" ? value : value.toISOString();

/**
 * Returns null when this viewer has no business with the client, so the caller
 * filters rather than rendering a zeroed week.
 */
export function serializeKpi(
  kpi: KpiSource,
  viewer: Viewer,
  client: { id: string; serviceIds?: readonly string[] },
): SerializedKpi | null {
  if (!canSeeClientKpis(viewer, client)) return null;
  return { ...kpi, weekStart: iso(kpi.weekStart) };
}

export function serializeKpis(
  kpis: readonly KpiSource[],
  viewer: Viewer,
  client: { id: string; serviceIds?: readonly string[] },
): SerializedKpi[] {
  if (!canSeeClientKpis(viewer, client)) return [];
  return kpis.map((kpi) => ({ ...kpi, weekStart: iso(kpi.weekStart) }));
}
