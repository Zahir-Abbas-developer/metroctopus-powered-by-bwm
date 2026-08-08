"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDownRight, ArrowUpRight, LineChart as LineChartIcon, Minus, Plus } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { useToast } from "@/components/ui/Toast";
import { KpiEntryModal } from "@/components/kpis/KpiEntryModal";
import { KpiCharts } from "@/components/kpis/KpiCharts";
import { formatMoney } from "@/lib/pipeline-types";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";

export type KpiWeekRow = {
  id: string;
  weekStart: string;
  googleSpend: number;
  metaSpend: number;
  spend: number;
  revenue: number;
  orders: number;
  storeSessions: number;
  roas: number | null;
  conversionRate: number | null;
  averageOrderValue: number | null;
  costPerOrder: number | null;
  notes: string | null;
  enteredBy: string | null;
};

type Payload = {
  client: { id: string; businessName: string; targetRoas: number | null };
  targetRoas: number;
  alert: { firing: boolean; weeksBelow: number; target: number; latestRoas: number | null };
  trends: Record<
    "roas" | "revenue" | "spend" | "orders",
    { delta: number | null; deltaPercent: number | null; direction: string }
  >;
  summary: {
    weeks: number;
    spend: number;
    revenue: number;
    orders: number;
    roas: number | null;
    conversionRate: number | null;
  };
  weeks: KpiWeekRow[];
};

/**
 * Did the work make money?
 *
 * The question the retainer is actually judged on, and the one the app
 * couldn't answer until now. Everything else here measures whether we did what
 * we said; this measures whether it was worth doing.
 */
export function KpiPanel({ clientId, canEdit }: { clientId: string; canEdit: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [entering, setEntering] = useState(false);
  const [editing, setEditing] = useState<KpiWeekRow | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/clients/${clientId}/kpis?weeks=12`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") return <Skeleton className="h-[520px] rounded-card" />;

  if (state === "error" || !data) {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load performance"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const latest = data.weeks.at(-1) ?? null;

  return (
    <div className="space-y-5">
      {data.alert.firing && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-card border border-danger/25 bg-danger-tint px-4 py-3.5"
        >
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-danger">
              Performance attention — {data.alert.weeksBelow} weeks under target
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-danger/85">
              ROAS is {data.alert.latestRoas ?? "—"} against a target of{" "}
              {data.alert.target}. Worth a conversation before they start one.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            Performance
          </h2>
          <p className="mt-0.5 text-[13px] text-ink/50">
            {data.summary.weeks === 0
              ? "No weeks logged yet"
              : `Last ${data.summary.weeks} weeks · target ROAS ${data.targetRoas}`}
          </p>
        </div>

        {canEdit && (
          <Button
            size="sm"
            icon={<Plus className="h-3.5 w-3.5" />}
            onClick={() => {
              setEditing(null);
              setEntering(true);
            }}
          >
            Log a week
          </Button>
        )}
      </div>

      {data.weeks.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={LineChartIcon}
            eyebrow="No data yet"
            title="Nothing logged"
            description="Two minutes a week: spend, revenue, orders and sessions. Everything here — the charts, the alerts, the client report — comes from those five numbers."
            action={
              canEdit ? <Button onClick={() => setEntering(true)}>Log the first week</Button> : undefined
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="ROAS"
              value={latest?.roas ?? "—"}
              icon={LineChartIcon}
              tone={
                latest?.roas === null || latest?.roas === undefined
                  ? "neutral"
                  : latest.roas >= data.targetRoas
                    ? "success"
                    : latest.roas >= data.targetRoas * 0.75
                      ? "warning"
                      : "danger"
              }
              hint={<TrendHint trend={data.trends.roas} suffix={`vs ${data.targetRoas} target`} />}
            />
            <StatCard
              label="Revenue"
              value={formatMoney(latest?.revenue ?? 0, true)}
              hint={<TrendHint trend={data.trends.revenue} suffix="week on week" />}
            />
            <StatCard
              label="Ad spend"
              value={formatMoney(latest?.spend ?? 0, true)}
              hint={<TrendHint trend={data.trends.spend} suffix="week on week" invert />}
            />
            <StatCard
              label="Orders"
              value={latest?.orders ?? 0}
              hint={<TrendHint trend={data.trends.orders} suffix="week on week" />}
            />
          </div>

          <KpiCharts weeks={data.weeks} targetRoas={data.targetRoas} />

          <Card padded={false}>
            <div className="border-b border-line px-5 py-4">
              <h3 className="font-display text-base font-bold tracking-tight text-ink">
                Weekly log
              </h3>
              <p className="mt-0.5 text-[13px] text-ink/50">
                Newest first. ROAS and conversion are computed, never typed.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse text-sm">
                <thead className="bg-cream">
                  <tr>
                    {["Week", "Spend", "Revenue", "ROAS", "Orders", "CVR", "AOV"].map((label) => (
                      <th
                        key={label}
                        scope="col"
                        className="eyebrow border-b border-line px-4 py-3 text-left text-ink/50"
                      >
                        {label}
                      </th>
                    ))}
                    {canEdit && <th className="border-b border-line" />}
                  </tr>
                </thead>

                <tbody className="divide-y divide-line">
                  {[...data.weeks].reverse().map((week) => (
                    <tr key={week.id}>
                      <td className="whitespace-nowrap px-4 py-3 text-[13px] text-ink">
                        {formatDate(week.weekStart)}
                        {week.enteredBy && (
                          <span className="ml-2 text-[11px] text-ink/35">{week.enteredBy}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ink/70">
                        {formatMoney(week.spend, true)}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ink/70">
                        {formatMoney(week.revenue, true)}
                      </td>
                      <td
                        className={cn(
                          "px-4 py-3 font-medium tabular-nums",
                          week.roas === null
                            ? "text-ink/30"
                            : week.roas >= data.targetRoas
                              ? "text-brand"
                              : "text-danger",
                        )}
                      >
                        {week.roas ?? "—"}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ink/70">{week.orders}</td>
                      <td className="px-4 py-3 tabular-nums text-ink/70">
                        {week.conversionRate === null ? "—" : `${week.conversionRate}%`}
                      </td>
                      <td className="px-4 py-3 tabular-nums text-ink/70">
                        {week.averageOrderValue === null
                          ? "—"
                          : formatMoney(Math.round(week.averageOrderValue))}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(week);
                              setEntering(true);
                            }}
                          >
                            Edit
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <KpiEntryModal
        open={entering}
        clientId={clientId}
        existing={editing}
        onClose={() => {
          setEntering(false);
          setEditing(null);
        }}
        onSaved={(alertFired) => {
          setEntering(false);
          setEditing(null);
          toast.success(
            alertFired
              ? "Logged. That's two weeks under target — the team has been told."
              : "Logged.",
          );
          void load();
        }}
      />
    </div>
  );
}

/** A trend arrow that knows falling spend is good and falling revenue isn't. */
function TrendHint({
  trend,
  suffix,
  invert = false,
}: {
  trend: { delta: number | null; deltaPercent: number | null; direction: string };
  suffix: string;
  invert?: boolean;
}) {
  if (trend.direction === "unknown") {
    return <span className="text-ink/45">{suffix}</span>;
  }

  const up = trend.direction === "up";
  const good = invert ? !up : up;

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-medium",
          trend.direction === "flat" ? "text-ink/45" : good ? "text-brand" : "text-danger",
        )}
      >
        {trend.direction === "flat" ? (
          <Minus className="h-3 w-3" />
        ) : up ? (
          <ArrowUpRight className="h-3 w-3" />
        ) : (
          <ArrowDownRight className="h-3 w-3" />
        )}
        {trend.deltaPercent !== null ? `${Math.abs(trend.deltaPercent)}%` : ""}
      </span>
      <span className="text-ink/45">{suffix}</span>
    </span>
  );
}
