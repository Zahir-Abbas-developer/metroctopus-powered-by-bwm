import { CalendarClock, CheckCircle2, TriangleAlert } from "lucide-react";

import { ProgressBar } from "@/components/ui/ProgressBar";
import { formatDate, formatDateTime } from "@/lib/date";
import { REPORT_TYPE_LABEL, type ClientReportPayload } from "@/lib/report-types";

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
          Agency OS · {REPORT_TYPE_LABEL.CLIENT_WEEKLY} · {payload.period.label}
        </span>
        <span>Generated {formatDateTime(generatedAt)} · Asia/Karachi</span>
      </footer>
    </article>
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
