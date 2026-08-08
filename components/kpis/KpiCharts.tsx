"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card } from "@/components/ui/Card";
import { formatMoney } from "@/lib/pipeline-types";
import type { KpiWeekRow } from "@/components/kpis/KpiPanel";

/**
 * Spend against revenue, ROAS against target, and orders.
 *
 * Three charts rather than one with three axes: a dual-axis chart lets you
 * draw any two series as though they move together, which is exactly the
 * misreading a client conversation doesn't need.
 *
 * The palette comes from CLAUDE.md rather than recharts' defaults, so these
 * look like part of the product instead of like a library dropped into it.
 */

const INK = "#0C0C0A";
const BRAND = "#1A6B3A";
const LINE = "#E2E0D8";
const DANGER = "#C0392B";
const INFO = "#1A4FA0";
const WARN = "#C4730A";

const AXIS = {
  stroke: "#0C0C0A",
  strokeOpacity: 0.25,
  tick: { fill: INK, fillOpacity: 0.45, fontSize: 11 },
  tickLine: false,
} as const;

export function KpiCharts({
  weeks,
  targetRoas,
}: {
  weeks: KpiWeekRow[];
  targetRoas: number;
}) {
  const data = weeks.map((week) => ({
    week: new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(week.weekStart)),
    spend: week.spend,
    revenue: week.revenue,
    roas: week.roas,
    orders: week.orders,
  }));

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <ChartHeading
          title="Spend and revenue"
          description="What went in against what came back, week by week."
        />
        <div className="mt-4 h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} tickFormatter={(value) => formatMoney(Number(value), true)} />
              <Tooltip
                cursor={{ fill: "rgba(12,12,10,0.04)" }}
                contentStyle={TOOLTIP}
                formatter={(value, name) => [formatMoney(Number(value ?? 0)), String(name)]}
              />
              <Legend wrapperStyle={LEGEND} />
              <Bar dataKey="spend" name="Ad spend" fill={INFO} radius={[3, 3, 0, 0]} />
              <Bar dataKey="revenue" name="Revenue" fill={BRAND} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <ChartHeading
          title="ROAS against target"
          description={`The dashed line is this client's target of ${targetRoas}.`}
        />
        <div className="mt-4 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} />
              <Tooltip
                contentStyle={TOOLTIP}
                formatter={(value) => [String(value ?? "—"), "ROAS"]}
              />
              <ReferenceLine
                y={targetRoas}
                stroke={WARN}
                strokeDasharray="4 4"
                strokeWidth={1.5}
              />
              <Line
                type="monotone"
                dataKey="roas"
                name="ROAS"
                stroke={BRAND}
                strokeWidth={2}
                // A week with no spend has no ROAS. Connecting across the gap
                // would draw a trend through a week nobody ran ads in.
                connectNulls={false}
                dot={{ r: 3, fill: BRAND, strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <Card>
        <ChartHeading title="Orders" description="Volume, independent of basket size." />
        <div className="mt-4 h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -24 }}>
              <CartesianGrid stroke={LINE} vertical={false} />
              <XAxis dataKey="week" {...AXIS} />
              <YAxis {...AXIS} allowDecimals={false} />
              <Tooltip
                cursor={{ fill: "rgba(12,12,10,0.04)" }}
                contentStyle={TOOLTIP}
                formatter={(value) => [String(value ?? 0), "Orders"]}
              />
              <Bar dataKey="orders" name="Orders" fill={INK} fillOpacity={0.75} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

const TOOLTIP = {
  border: `1px solid ${LINE}`,
  borderRadius: 10,
  background: "#FFFFFF",
  boxShadow: "0 14px 32px -18px rgba(12,12,10,0.4)",
  fontSize: 13,
  color: INK,
} as const;

const LEGEND = { fontSize: 12, paddingTop: 8 } as const;

function ChartHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="font-display text-base font-bold tracking-tight text-ink">{title}</h3>
      <p className="mt-0.5 text-[13px] text-ink/50">{description}</p>
    </div>
  );
}

/** Referenced by the ROAS chart's colour choice; kept for the danger tone. */
export const ROAS_BELOW_COLOR = DANGER;
