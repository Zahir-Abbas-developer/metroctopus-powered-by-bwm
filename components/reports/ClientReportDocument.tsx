import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Hourglass,
  Minus,
  TriangleAlert,
} from "lucide-react";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatDate, formatDateTime } from "@/lib/date";
import { REPORT_TYPE_LABEL, type ClientReportPayload } from "@/lib/report-types";
import { cn } from "@/lib/utils";

/**
 * The client weekly as a printable document.
 *
 * Internal for now, but written as if the client will read it — which is what
 * makes it useful in a Friday check-in call, and what a client portal would
 * later reuse unchanged.
 */
export function ClientReportDocument({
  payload,
  generatedAt,
}: {
  payload: ClientReportPayload;
  generatedAt: string;
}) {
  return (
    <article className="report-document space-y-6">
      <header className="report-header surface-dark overflow-hidden rounded-card border border-ink">
        <div className="relative px-7 py-8 sm:px-10 sm:py-10">
          <p className="eyebrow mb-3 text-brand-tint/70">
            {REPORT_TYPE_LABEL.CLIENT_WEEKLY} · {payload.period.label}
          </p>

          <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-paper sm:text-[34px]">
            {payload.client.name}
          </h1>

          {payload.project && (
            <p className="mt-2 text-[13px] text-paper/50">
              {payload.project.title} · {formatDate(payload.project.startDate)} –{" "}
              {formatDate(payload.project.endDate)}
            </p>
          )}

          <p className="mt-7 max-w-2xl text-[15px] leading-relaxed text-paper/75">
            {payload.narrative}
          </p>

          {payload.project && (
            <div className="mt-8 max-w-xl">
              <ProgressBar
                onDark
                showValue
                value={payload.project.completionPercent}
                label={`${payload.project.done} of ${payload.project.total} milestones complete`}
              />
            </div>
          )}
        </div>
      </header>

      <Section
        icon={CheckCircle2}
        title="Completed this week"
        empty="No milestones were completed this week."
        count={payload.completedThisPeriod.length}
      >
        {payload.completedThisPeriod.map((item, index) => (
          <Row
            key={`${item.title}-${index}`}
            module={item.module}
            title={item.title}
            meta={`Completed ${formatDate(item.completedAt)}${item.assignee ? ` · ${item.assignee}` : ""}`}
            tone="good"
          />
        ))}
      </Section>

      <Section
        icon={CalendarClock}
        title="Planned for next week"
        empty="Nothing is scheduled for next week."
        count={payload.plannedNextPeriod.length}
      >
        {payload.plannedNextPeriod.map((item, index) => (
          <Row
            key={`${item.title}-${index}`}
            module={item.module}
            title={item.title}
            meta={`Due ${formatDate(item.dueDate)}${item.assignee ? ` · ${item.assignee}` : ""}`}
          />
        ))}
      </Section>

      {payload.kpis?.week && (
        <section className="report-section rounded-card border border-line bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-6 py-4">
            <div>
              <h2 className="font-display text-base font-bold tracking-tight text-ink">
                What the work returned
              </h2>
              <p className="mt-0.5 text-[13px] text-ink/50">
                Week of {formatDate(payload.kpis.week.weekStart)} · target ROAS{" "}
                {payload.kpis.targetRoas}
              </p>
            </div>

            {payload.kpis.alertFiring && (
              <span className="rounded-pill border border-danger/25 bg-danger-tint px-2.5 py-1 text-[11px] font-medium text-danger">
                Under target
              </span>
            )}
          </div>

          <div className="grid gap-px bg-line sm:grid-cols-4">
            <KpiCell
              label="Ad spend"
              value={`$${payload.kpis.week.spend.toLocaleString("en-US")}`}
              trend={payload.kpis.trends.spend}
              invert
            />
            <KpiCell
              label="Revenue"
              value={`$${payload.kpis.week.revenue.toLocaleString("en-US")}`}
              trend={payload.kpis.trends.revenue}
            />
            <KpiCell
              label="ROAS"
              value={payload.kpis.week.roas === null ? "—" : String(payload.kpis.week.roas)}
              trend={payload.kpis.trends.roas}
              tone={
                payload.kpis.week.roas === null
                  ? undefined
                  : payload.kpis.week.roas >= payload.kpis.targetRoas
                    ? "good"
                    : "bad"
              }
            />
            <KpiCell
              label="Orders"
              value={String(payload.kpis.week.orders)}
              trend={payload.kpis.trends.orders}
            />
          </div>

          {payload.kpis.summary.weeks > 1 && (
            <p className="border-t border-line px-6 py-3 text-[13px] text-ink/50">
              Across {payload.kpis.summary.weeks} weeks: $
              {payload.kpis.summary.spend.toLocaleString("en-US")} spent, $
              {payload.kpis.summary.revenue.toLocaleString("en-US")} returned
              {payload.kpis.summary.roas !== null
                ? ` — a blended ROAS of ${payload.kpis.summary.roas}.`
                : "."}
            </p>
          )}
        </section>
      )}

      {payload.awaitingInput && payload.awaitingInput.items.length > 0 && (
        <Section
          icon={Hourglass}
          title="Items awaiting your input"
          empty=""
          count={payload.awaitingInput.items.length}
        >
          <p className="px-6 pb-1 pt-1 text-[13px] leading-relaxed text-ink/55">
            These are paused on our side until we hear back —{" "}
            {payload.awaitingInput.totalDays}{" "}
            {payload.awaitingInput.totalDays === 1 ? "day" : "days"} in total so
            far. Their deadlines move out by the same amount, so nothing is lost
            by taking the time you need.
          </p>
          {payload.awaitingInput.items.map((item, index) => (
            <Row
              key={`${item.title}-${index}`}
              module="Waiting"
              title={item.title}
              meta={`${item.note} · since ${formatDate(item.since)} (${item.days} day${item.days === 1 ? "" : "s"})`}
            />
          ))}
        </Section>
      )}

      {payload.overdue.length > 0 && (
        <Section
          icon={TriangleAlert}
          title="Overdue"
          empty=""
          count={payload.overdue.length}
          tone="bad"
        >
          {payload.overdue.map((item, index) => (
            <Row
              key={`${item.title}-${index}`}
              module={item.module}
              title={item.title}
              meta={`Was due ${formatDate(item.dueDate)} · ${item.daysLate} day${item.daysLate === 1 ? "" : "s"} late${item.assignee ? ` · ${item.assignee}` : ""}`}
              tone="bad"
            />
          ))}
        </Section>
      )}

      <footer className="report-footer flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[12px] text-ink/40">
        <span>
          Metroctopus · {REPORT_TYPE_LABEL.CLIENT_WEEKLY} · {payload.period.label}
        </span>
        <span>Generated {formatDateTime(generatedAt)} · Asia/Karachi</span>
      </footer>
    </article>
  );
}

/** One figure with its week-on-week arrow. */
function KpiCell({
  label,
  value,
  trend,
  tone,
  invert = false,
}: {
  label: string;
  value: string;
  trend: { deltaPercent: number | null; direction: string };
  tone?: "good" | "bad";
  /** Falling spend is good news; falling revenue isn't. */
  invert?: boolean;
}) {
  const up = trend.direction === "up";
  const good = invert ? !up : up;

  return (
    <div className="bg-white px-6 py-5">
      <p className="eyebrow text-ink/45">{label}</p>
      <p
        className={cn(
          "mt-2.5 font-display text-2xl font-extrabold tabular-nums",
          tone === "good" ? "text-brand" : tone === "bad" ? "text-danger" : "text-ink",
        )}
      >
        {value}
      </p>
      {trend.direction !== "unknown" && trend.deltaPercent !== null && (
        <p
          className={cn(
            "mt-1.5 inline-flex items-center gap-1 text-[12px] font-medium",
            trend.direction === "flat" ? "text-ink/40" : good ? "text-brand" : "text-danger",
          )}
        >
          {trend.direction === "flat" ? (
            <Minus className="h-3 w-3" />
          ) : up ? (
            <ArrowUpRight className="h-3 w-3" />
          ) : (
            <ArrowDownRight className="h-3 w-3" />
          )}
          {Math.abs(trend.deltaPercent)}% on last week
        </p>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  empty,
  tone,
  children,
}: {
  icon: typeof CheckCircle2;
  title: string;
  count: number;
  empty: string;
  tone?: "bad";
  children: React.ReactNode;
}) {
  return (
    <section className="report-section rounded-card border border-line bg-white">
      <div className="flex items-center justify-between gap-3 border-b border-line px-6 py-4">
        <h2 className="flex items-center gap-2.5 font-display text-base font-bold tracking-tight text-ink">
          <Icon className={tone === "bad" ? "h-4 w-4 text-danger" : "h-4 w-4 text-brand"} />
          {title}
        </h2>
        <span className="font-display text-sm font-bold tabular-nums text-ink/40">
          {count}
        </span>
      </div>

      {count === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-ink/45">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">{children}</ul>
      )}
    </section>
  );
}

function Row({
  module,
  title,
  meta,
  tone,
}: {
  module: string;
  title: string;
  meta: string;
  tone?: "good" | "bad";
}) {
  return (
    <li className="report-row px-6 py-3.5">
      <p className="eyebrow mb-1 text-ink/35">{module}</p>
      <p className="text-sm font-medium text-ink">{title}</p>
      <p
        className={
          tone === "bad"
            ? "mt-0.5 text-[12px] text-danger"
            : "mt-0.5 text-[12px] text-ink/45"
        }
      >
        {meta}
      </p>
    </li>
  );
}
