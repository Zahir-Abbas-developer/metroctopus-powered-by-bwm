import type { Viewer } from "@/lib/visibility";
import { canSeeDealValue, canSeePipelineTotals } from "@/lib/visibility";

/**
 * Pipeline leads.
 *
 * A deal's value is agency money, so it follows the money rule rather than the
 * operational one: the owner sees every deal, a business developer sees the
 * deals they own because their targets are measured against them, and everyone
 * else — service leads included — sees the lead without the figure.
 */

export type LeadSource = {
  id: string;
  businessName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  country: string | null;
  interestedServices: string[];
  estimatedMonthlyValue: number | null;
  ownerId: string | null;
  stage: string;
  stageChangedAt: Date | string;
  lostReason: string | null;
  lostNote: string | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  activityCount: number;
  convertedClientId: string | null;
  createdAt: Date | string;
};

export type SerializedLead = Omit<LeadSource, "estimatedMonthlyValue" | "stageChangedAt" | "createdAt"> & {
  stageChangedAt: string;
  createdAt: string;
  /** Owner, or the business developer who owns this deal. Absent otherwise. */
  estimatedMonthlyValue?: number | null;
};

const iso = (value: Date | string): string =>
  typeof value === "string" ? value : value.toISOString();

export function serializeLead(lead: LeadSource, viewer: Viewer): SerializedLead {
  const { estimatedMonthlyValue, ...rest } = lead;

  const result: SerializedLead = {
    ...rest,
    stageChangedAt: iso(lead.stageChangedAt),
    createdAt: iso(lead.createdAt),
  };

  if (canSeeDealValue(viewer, { ownerId: lead.ownerId })) {
    result.estimatedMonthlyValue = estimatedMonthlyValue;
  }

  return result;
}

export const serializeLeads = (leads: readonly LeadSource[], viewer: Viewer): SerializedLead[] =>
  leads.map((lead) => serializeLead(lead, viewer));

export type PipelineMetricsSource = {
  stages: { stage: string; count: number; value: number }[];
  openValue: number;
  openCount: number;
  wonThisMonth: { count: number; value: number };
  winRate: number | null;
  averageDealSize: number | null;
};

export type SerializedPipelineMetrics = {
  /** Counts survive for everyone; the board still works without the money. */
  stages: { stage: string; count: number; value?: number }[];
  openCount: number;
  openValue?: number;
  wonThisMonth?: { count: number; value: number };
  winRate?: number | null;
  averageDealSize?: number | null;
};

/**
 * Aggregate pipeline figures.
 *
 * Money is omitted rather than zeroed for a non-owner. A board reading "0
 * open" is a statement about the business that happens to be false, and a
 * component cannot tell a withheld zero from a real one.
 */
export function serializePipelineMetrics(
  metrics: PipelineMetricsSource,
  viewer: Viewer,
): SerializedPipelineMetrics {
  if (canSeePipelineTotals(viewer)) {
    return { ...metrics };
  }

  return {
    stages: metrics.stages.map(({ stage, count }) => ({ stage, count })),
    openCount: metrics.openCount,
  };
}
