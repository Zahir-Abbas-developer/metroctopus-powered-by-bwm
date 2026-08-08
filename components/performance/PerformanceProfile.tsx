import Link from "next/link";
import {
  AlarmClock,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BellOff,
  CalendarX,
  Clock3,
  Gauge,
  Layers,
  Minus,
  ScrollText,
  SlidersHorizontal,
  ThumbsDown,
  TimerOff,
  TrendingUp,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { StatCard } from "@/components/ui/StatCard";
import { ManualAdjustButton } from "@/components/performance/ManualAdjustButton";
import { formatCycle, formatDateTime } from "@/lib/date";
import { MONTHLY_BASELINE, SCORE_EVENT_LABEL, formatPoints, type ScoreEventType } from "@/lib/scoring";
import type { Cycle, MemberScore, ScoreLedgerEntry } from "@/lib/score-service";
import { cn } from "@/lib/utils";

const EVENT_ICONS: Record<ScoreEventType, typeof Clock3> = {
  LATE: Clock3,
  MISSED: TimerOff,
  REJECTED: ThumbsDown,
  EARLY_BONUS: TrendingUp,
  MANUAL_ADJUST: SlidersHorizontal,
  ATTENDANCE_MISS: BellOff,
  LATE_CLOCK_IN: AlarmClock,
  ABSENT_DAY: CalendarX,
};

export type ProfileMember = {
  id: string;
  name: string;
  jobTitle: string;
  avatarColor: string;
};

/**
 * One member's performance for a cycle: the score as a ring in its band
 * colour, the trend against last month, and the ledger that produced it.
 *
 * Shared by the owner's view of a member (/team/[id]) and the member's own
 * (/my-performance) — same numbers, so there is nothing behind the curtain.
 */
export function PerformanceProfile({
  member,
  score,
  ledger,
  cycle,
  onTime,
  load,
  viewerIsAdmin,
  isSelf,
}: {
  member: ProfileMember;
  score: MemberScore;
  ledger: ScoreLedgerEntry[];
  cycle: Cycle;
  onTime: { onTime: number; total: number; rate: number };
  /** Volume the score was earned against — never shown without it. */
  load: { count: number; weight: number };
  viewerIsAdmin: boolean;
  isSelf: boolean;
}) {
  const deductionCount = ledger.filter((entry) => entry.points < 0).length;

  return (
    <div className="space-y-8">
      {viewerIsAdmin && !isSelf && (
        <Link
          href="/team"
          className="inline-flex items-center gap-1.5 text-[13px] text-ink/50 transition-colors hover:text-ink"
        >
          <ArrowRight className="h-3.5 w-3.5 rotate-180" />
          All team members
        </Link>
      )}

      {/* Score hero */}
      <Card surface="dark" padded={false}>
        <div className="px-6 py-8 sm:px-9 sm:py-10">
          <div className="flex flex-col items-start gap-8 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="eyebrow mb-3 text-brand-tint/70">
                {formatCycle(cycle)} · performance
              </p>

              <div className="flex items-center gap-3.5">
                <Avatar
                  name={member.name}
                  color={member.avatarColor}
                  size="lg"
                  className="ring-1 ring-paper/15"
                />
                <div className="min-w-0">
                  <h1 className="font-display text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-paper sm:text-[32px]">
                    {isSelf ? "Your performance" : member.name}
                  </h1>
                  <p className="mt-0.5 text-[13px] text-paper/50">
                    {isSelf ? member.name : member.jobTitle}
                  </p>
                </div>
              </div>

              <p className="mt-5 max-w-md text-[13px] leading-relaxed text-paper/50">
                Everyone starts each month at {MONTHLY_BASELINE} points. Points come off for
                late and missed deadlines and for rejected work, and early
                delivery earns them back.
              </p>
            </div>

            <div className="flex items-center gap-7">
              <ScoreRing score={score.score} size="lg" showLabel onDark />

              <div className="space-y-4">
                <TrendBlock trend={score.trend} />
                <div>
                  <p className="eyebrow text-paper/35">This month</p>
                  <p className="mt-1 text-sm text-paper/70">
                    {score.eventCount} event{score.eventCount === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Supporting numbers */}
      <div className="grid gap-4 sm:grid-cols-4">
        {/* No approvals yet is not the same as a 0% record — showing a red
            zero would read as failure when there is simply nothing to rate. */}
        <StatCard
          label="On-time rate"
          value={onTime.total === 0 ? "—" : onTime.rate}
          unit={onTime.total === 0 ? undefined : "%"}
          icon={Clock3}
          tone={
            onTime.total === 0
              ? "neutral"
              : onTime.rate >= 90
                ? "success"
                : onTime.rate >= 70
                  ? "warning"
                  : "danger"
          }
          hint={
            onTime.total === 0
              ? "Nothing has come due this month yet"
              : `${onTime.onTime} of ${onTime.total} submitted by their deadline`
          }
        />
        {/* The volume the score was earned against — without it the number
            above is not comparable to anyone else's. */}
        <StatCard
          label="Workload"
          value={load.count}
          icon={Layers}
          tone="neutral"
          hint={
            load.count === 0
              ? "Nothing due this month"
              : `${load.count} due this month · total weight ${load.weight}`
          }
        />
        <StatCard
          label="Points lost"
          value={Math.abs(score.deductions).toFixed(1)}
          icon={ArrowDownRight}
          tone={score.deductions === 0 ? "neutral" : "danger"}
          hint={`Across ${deductionCount} deduction${deductionCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Points earned"
          value={score.bonuses.toFixed(1)}
          icon={TrendingUp}
          tone={score.bonuses > 0 ? "success" : "neutral"}
          hint="Early deliveries and credits"
        />
      </div>

      {/* Ledger */}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              Score history
            </h2>
            <p className="mt-0.5 text-[13px] text-ink/50">
              Every change to {isSelf ? "your" : "this"} score in {formatCycle(cycle)},
              newest first.
            </p>
          </div>

          {viewerIsAdmin && (
            <ManualAdjustButton userId={member.id} memberName={member.name} />
          )}
        </div>

        {ledger.length === 0 ? (
          <EmptyState
            icon={Gauge}
            eyebrow="Clean sheet"
            title={`Still on ${MONTHLY_BASELINE} points`}
            description={
              isSelf
                ? "Nothing has affected your score this month. Keep delivering on time and it stays here."
                : "Nothing has affected this member's score this month."
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {ledger.map((entry) => {
              const type = entry.type as ScoreEventType;
              const Icon = EVENT_ICONS[type] ?? ScrollText;
              const manual = type === "MANUAL_ADJUST";
              const positive = entry.points > 0;

              return (
                <li
                  key={entry.id}
                  className={cn(
                    "flex items-start gap-3.5 px-5 py-4 sm:px-6",
                    // Manual adjustments read differently on purpose — they are
                    // a human decision, not an automatic rule firing.
                    manual && "bg-cream/60",
                  )}
                >
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
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-ink">
                        {entry.milestoneTitle ?? SCORE_EVENT_LABEL[type]}
                      </p>
                      {manual && (
                        <span className="rounded-pill border border-line bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink/50">
                          Manual
                        </span>
                      )}
                    </div>

                    <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
                      {entry.reason}
                    </p>

                    <p className="mt-1.5 text-[12px] text-ink/35">
                      {SCORE_EVENT_LABEL[type]}
                      {entry.clientName && ` · ${entry.clientName}`}
                      {` · ${formatDateTime(entry.createdAt)}`}
                      {entry.createdByName && ` · by ${entry.createdByName}`}
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
                    {formatPoints(entry.points)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function TrendBlock({ trend }: { trend: number | null }) {
  if (trend === null) {
    return (
      <div>
        <p className="eyebrow text-paper/35">vs last month</p>
        <p className="mt-1 text-sm text-paper/50">No history</p>
      </div>
    );
  }

  const flat = Math.abs(trend) < 0.05;
  const Icon = flat ? Minus : trend > 0 ? ArrowUpRight : ArrowDownRight;

  return (
    <div>
      <p className="eyebrow text-paper/35">vs last month</p>
      <p
        className={cn(
          "mt-1 flex items-center gap-1 font-display text-lg font-bold tabular-nums",
          flat && "text-paper/60",
          !flat && trend > 0 && "text-brand",
          !flat && trend < 0 && "text-danger",
        )}
      >
        <Icon className="h-4 w-4" />
        {flat ? "Level" : `${trend > 0 ? "+" : "−"}${Math.abs(trend).toFixed(1)}`}
      </p>
    </div>
  );
}
