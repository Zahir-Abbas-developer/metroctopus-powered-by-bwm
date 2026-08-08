import {
  ArrowDownRight,
  ArrowUpRight,
  Clock3,
  Minus,
  ScrollText,
  SlidersHorizontal,
  ThumbsDown,
  TimerOff,
  TrendingUp,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { formatDate, formatDateTime } from "@/lib/date";
import { SCORE_EVENT_LABEL, formatPoints, type ScoreEventType } from "@/lib/scoring";
import { REPORT_TYPE_LABEL, type MemberReportPayload, type ReportType } from "@/lib/report-types";
import { cn } from "@/lib/utils";

const EVENT_ICONS: Record<ScoreEventType, typeof Clock3> = {
  LATE: Clock3,
  MISSED: TimerOff,
  REJECTED: ThumbsDown,
  EARLY_BONUS: TrendingUp,
  MANUAL_ADJUST: SlidersHorizontal,
};

/**
 * The member performance report as a printable document.
 *
 * Everything here comes out of the frozen payload — nothing is re-queried, so
 * the document says the same thing in a year as it did the day it was made.
 * `voice` picks which of the two stored narratives to show: the member reads
 * "You completed…", the owner reads "Ayesha completed…".
 */
export function MemberReportDocument({
  payload,
  type,
  generatedAt,
  voice = "second",
}: {
  payload: MemberReportPayload;
  type: ReportType;
  generatedAt: string;
  voice?: "second" | "third";
}) {
  const { score, milestones, points } = payload;
  const narrative = voice === "second" ? payload.narrative.second : payload.narrative.third;

  return (
    <article className="report-document space-y-6">
      {/* Dark editorial masthead */}
      <header className="report-header surface-dark overflow-hidden rounded-card border border-ink">
        <div className="relative px-7 py-8 sm:px-10 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <p className="eyebrow mb-3 text-brand-tint/70">
                {REPORT_TYPE_LABEL[type]} · {payload.period.label}
              </p>

              <div className="flex items-center gap-3.5">
                <Avatar
                  name={payload.member.name}
                  color={payload.member.avatarColor}
                  size="lg"
                  className="ring-1 ring-paper/15"
                />
                <div className="min-w-0">
                  <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-paper sm:text-[34px]">
                    {payload.member.name}
                  </h1>
                  <p className="mt-0.5 text-[13px] text-paper/50">
                    {payload.member.jobTitle}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-6">
              <ScoreRing score={score.value} size="md" showLabel onDark />
              <div className="space-y-3">
                <Delta delta={score.delta} phrase={payload.period.phrase} />
                <div>
                  <p className="eyebrow text-paper/35">On-time rate</p>
                  <p className="mt-1 font-display text-lg font-bold tabular-nums text-paper/85">
                    {milestones.completed === 0 ? "—" : `${payload.onTimeRate}%`}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <p className="mt-8 max-w-2xl text-[15px] leading-relaxed text-paper/75">
            {narrative}
          </p>
        </div>
      </header>

      {/* At a glance */}
      <section className="report-section grid gap-3 sm:grid-cols-4">
        <Figure label="Completed" value={milestones.completed} hint="Approved this period" />
        <Figure
          label="On time"
          value={milestones.onTime}
          hint="Delivered by deadline"
          tone={milestones.onTime === milestones.completed && milestones.completed > 0 ? "good" : undefined}
        />
        <Figure
          label="Late"
          value={milestones.late}
          hint="Delivered after deadline"
          tone={milestones.late > 0 ? "bad" : undefined}
        />
        <Figure
          label="Missed"
          value={milestones.missed}
          hint="Never completed"
          tone={milestones.missed > 0 ? "bad" : undefined}
        />
      </section>

      {/* Points */}
      <section className="report-section rounded-card border border-line bg-white">
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            Points this period
          </h2>
          <p className="mt-0.5 text-[13px] text-ink/50">
            Every member starts each month at 100.
          </p>
        </div>

        <div className="grid gap-px bg-line sm:grid-cols-3">
          <PointsCell label="Gained" value={points.gained} tone="good" />
          <PointsCell label="Lost" value={points.lost} tone="bad" />
          <PointsCell label="Net" value={points.net} tone={points.net >= 0 ? "good" : "bad"} />
        </div>
      </section>

      {/* Ledger */}
      <section className="report-section rounded-card border border-line bg-white">
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            What changed the score
          </h2>
          <p className="mt-0.5 text-[13px] text-ink/50">
            {payload.events.length === 0
              ? "Nothing affected the score this period."
              : `${payload.events.length} event${payload.events.length === 1 ? "" : "s"}, newest first.`}
          </p>
        </div>

        {payload.events.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-ink/45">
            A clean sheet — the score held at {score.value}.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {payload.events.map((event) => {
              const Icon = EVENT_ICONS[event.type] ?? ScrollText;
              const positive = event.points > 0;

              return (
                <li key={event.id} className="report-row flex items-start gap-3.5 px-6 py-4">
                  <span
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border",
                      positive
                        ? "border-brand/20 bg-brand-tint text-brand"
                        : "border-danger/20 bg-danger-tint text-danger",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">
                      {event.milestoneTitle ?? SCORE_EVENT_LABEL[event.type]}
                    </p>
                    <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
                      {event.reason}
                    </p>
                    <p className="mt-1.5 text-[12px] text-ink/35">
                      {SCORE_EVENT_LABEL[event.type]}
                      {event.clientName && ` · ${event.clientName}`}
                      {` · ${formatDate(event.at)}`}
                    </p>
                  </div>

                  <span
                    className={cn(
                      "shrink-0 rounded-pill border px-2.5 py-1 text-[13px] font-bold tabular-nums",
                      positive
                        ? "border-brand/20 bg-brand-tint text-brand"
                        : "border-danger/20 bg-danger-tint text-danger",
                    )}
                  >
                    {formatPoints(event.points)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="report-footer flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4 text-[12px] text-ink/40">
        <span>
          Agency OS · {REPORT_TYPE_LABEL[type]} · {payload.period.label}
        </span>
        <span>Generated {formatDateTime(generatedAt)} · Asia/Karachi</span>
      </footer>
    </article>
  );
}

function Delta({ delta, phrase }: { delta: number | null; phrase: string }) {
  if (delta === null) {
    return (
      <div>
        <p className="eyebrow text-paper/35">vs last {phrase}</p>
        <p className="mt-1 text-sm text-paper/50">No history</p>
      </div>
    );
  }

  const flat = Math.abs(delta) < 0.05;
  const Icon = flat ? Minus : delta > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div>
      <p className="eyebrow text-paper/35">vs last {phrase}</p>
      <p
        className={cn(
          "mt-1 flex items-center gap-1 font-display text-lg font-bold tabular-nums",
          flat && "text-paper/60",
          !flat && delta > 0 && "text-brand",
          !flat && delta < 0 && "text-danger",
        )}
      >
        <Icon className="h-4 w-4" />
        {flat ? "Level" : `${delta > 0 ? "+" : "−"}${Math.abs(delta).toFixed(1)}`}
      </p>
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="rounded-card border border-line bg-white p-5">
      <p className="eyebrow text-ink/45">{label}</p>
      <p
        className={cn(
          "mt-4 font-display text-[32px] font-extrabold leading-none tracking-[-0.03em]",
          tone === "good" && "text-brand",
          tone === "bad" && "text-danger",
          !tone && "text-ink",
        )}
      >
        {value}
      </p>
      <p className="mt-2 text-[12px] text-ink/45">{hint}</p>
    </div>
  );
}

function PointsCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "bad";
}) {
  return (
    <div className="bg-white px-6 py-5">
      <p className="eyebrow text-ink/45">{label}</p>
      <p
        className={cn(
          "mt-3 font-display text-2xl font-extrabold tabular-nums",
          value === 0 ? "text-ink/40" : tone === "good" ? "text-brand" : "text-danger",
        )}
      >
        {value === 0 ? "0.0" : formatPoints(value)}
      </p>
    </div>
  );
}
