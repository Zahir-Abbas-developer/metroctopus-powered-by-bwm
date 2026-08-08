"use client";

import { CheckCircle2, LogIn, LogOut, Moon, Play, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useAttendance, useTicker } from "@/components/attendance/useAttendance";
import {
  formatDuration,
  formatKarachiClock,
  formatKarachiTime,
  karachiMinutes,
} from "@/lib/attendance-time";
import { cn } from "@/lib/utils";

/**
 * The member's day, at the top of their dashboard.
 *
 * Three states: not started, working, finished. The live clock and the elapsed
 * timer both run on Karachi time computed from the server's instant, not the
 * device's — the whole system reasons in one timezone and this is where a
 * member would otherwise notice the difference.
 */
export function AttendanceCard() {
  const { state, loading, busy, act, serverNow } = useAttendance();
  const toast = useToast();

  useTicker(1000);

  if (loading || !state) {
    return <Skeleton className="h-[168px] rounded-card" />;
  }

  const now = new Date(serverNow());
  const nowMinutes = karachiMinutes(now);
  const { day, settings } = state;

  if (state.dayKind !== "WORKDAY") {
    return (
      <Card surface="dark" padded={false}>
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-6 py-6 sm:px-8">
          <div>
            <p className="eyebrow mb-2 text-brand-tint/70">
              {state.dayKind === "LEAVE" ? "Approved leave" : "Rest day"}
            </p>
            <h2 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-paper">
              {state.dayKind === "LEAVE" ? "You're off today" : "Today is a day off"}
            </h2>
            <p className="mt-1.5 text-[13px] text-paper/55">
              No availability checks, no attendance impact.
            </p>
          </div>
          <Moon aria-hidden className="h-8 w-8 text-paper/25" />
        </div>
      </Card>
    );
  }

  // --- Finished ------------------------------------------------------------
  if (day?.clockOutAt) {
    return (
      <Card surface="dark" padded={false}>
        <div className="relative px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="eyebrow mb-2 text-brand-tint/70">Day complete</p>
              <h2 className="font-display text-[22px] font-extrabold tracking-[-0.02em] text-paper">
                {formatDuration(day.totalMinutes ?? 0)} worked
              </h2>
              <p className="mt-1.5 text-[13px] text-paper/55">
                {formatKarachiTime(new Date(day.clockInAt!))} –{" "}
                {formatKarachiTime(new Date(day.clockOutAt))}
                {day.autoClosed && " · closed automatically at the end of the shift"}
              </p>
            </div>

            <div className="text-right">
              <p className="eyebrow text-paper/35">Availability</p>
              <p
                className={cn(
                  "mt-1 font-display text-2xl font-extrabold tabular-nums",
                  state.tally.missed > 0 ? "text-danger" : "text-brand",
                )}
              >
                {state.tally.passed}/{state.tally.resolved}
                {state.tally.missed === 0 && state.tally.resolved > 0 && " ✓"}
              </p>
              <p className="mt-0.5 text-[12px] text-paper/45">checks passed</p>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // --- Working -------------------------------------------------------------
  if (day?.clockInAt) {
    const elapsed = Math.max(
      0,
      Math.floor((serverNow() - new Date(day.clockInAt).getTime()) / 60_000),
    );

    return (
      <Card surface="dark" padded={false}>
        <div className="relative px-6 py-6 sm:px-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="eyebrow mb-2 flex items-center gap-2 text-brand-tint/70">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-pill bg-brand opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-pill bg-brand" />
                </span>
                Working since {formatKarachiTime(new Date(day.clockInAt))}
              </p>

              <h2 className="font-display text-[34px] font-extrabold leading-none tracking-[-0.03em] text-paper tabular-nums">
                {formatDuration(elapsed)}
              </h2>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {day.status === "LATE" && (
                  <Badge tone="warning" size="sm">
                    Late start
                  </Badge>
                )}
                {state.tally.resolved > 0 && (
                  <Badge tone={state.tally.missed > 0 ? "danger" : "success"} size="sm">
                    {state.tally.passed}/{state.tally.resolved} checks passed
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              <div className="text-right">
                <p className="eyebrow text-paper/35">Karachi</p>
                <p className="mt-1 font-display text-lg font-bold tabular-nums text-paper/85">
                  {formatKarachiClock(nowMinutes)}
                </p>
              </div>

              <Button
                variant="secondary"
                size="sm"
                loading={busy}
                icon={<LogOut className="h-3.5 w-3.5" />}
                onClick={async () => {
                  const result = await act("CLOCK_OUT");
                  if (result.ok) {
                    toast.success(
                      `Day ended — ${formatDuration(result.body.totalMinutes ?? 0)} worked.`,
                    );
                  } else {
                    toast.error(result.body?.error ?? "Couldn't end your day.");
                  }
                }}
              >
                End My Day
              </Button>
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // --- Not started ---------------------------------------------------------
  const tooEarly = nowMinutes < settings.clockInOpensMinutes;
  const tooLate = nowMinutes >= settings.absentCutoffMinutes;
  const wouldBeLate = nowMinutes > settings.shiftStartMinutes + settings.graceMinutes;

  return (
    <Card surface="dark" padded={false}>
      <div className="relative px-6 py-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="min-w-0">
            <p className="eyebrow mb-2 text-brand-tint/70">
              {new Intl.DateTimeFormat("en-GB", {
                timeZone: "Asia/Karachi",
                weekday: "long",
                day: "numeric",
                month: "long",
              }).format(now)}
            </p>

            <h2 className="font-display text-[26px] font-extrabold tracking-[-0.02em] text-paper">
              {day?.status === "ABSENT" ? "Marked absent" : "Ready when you are"}
            </h2>

            <p className="mt-2 max-w-md text-[13px] leading-relaxed text-paper/55">
              {day?.status === "ABSENT"
                ? `No clock-in by ${formatKarachiClock(settings.absentCutoffMinutes)}. Ask the owner to excuse today if that's wrong.`
                : tooEarly
                  ? `Clock-in opens at ${formatKarachiClock(settings.clockInOpensMinutes)}.`
                  : wouldBeLate
                    ? `Starting now counts as late — the grace period ended at ${formatKarachiClock(settings.shiftStartMinutes + settings.graceMinutes)}.`
                    : `Your shift runs to ${formatKarachiClock(settings.shiftEndMinutes)}.`}
            </p>
          </div>

          <div className="flex flex-col items-end gap-3">
            <div className="text-right">
              <p className="eyebrow text-paper/35">Karachi time</p>
              <p className="mt-1 font-display text-[28px] font-extrabold leading-none tabular-nums text-paper">
                {formatKarachiClock(nowMinutes)}
              </p>
            </div>

            <Button
              size="lg"
              disabled={tooEarly || tooLate}
              loading={busy}
              icon={
                tooLate ? <XCircle className="h-4 w-4" /> : <Play className="h-4 w-4" />
              }
              onClick={async () => {
                const result = await act("CLOCK_IN");
                if (result.ok) {
                  toast.success(
                    result.body.late
                      ? "Day started — recorded as a late start."
                      : "Day started. Have a good one.",
                  );
                } else {
                  toast.error(result.body?.error ?? "Couldn't start your day.");
                }
              }}
            >
              {tooLate ? "Clock-in closed" : "Start My Day"}
            </Button>
          </div>
        </div>

        {state.tally.resolved > 0 && (
          <div className="mt-5 flex items-center gap-2 border-t border-paper/10 pt-4">
            {state.tally.missed > 0 ? (
              <XCircle aria-hidden className="h-3.5 w-3.5 text-danger" />
            ) : (
              <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-brand" />
            )}
            <p className="text-[12px] text-paper/50">
              {state.tally.passed} of {state.tally.resolved} availability checks passed today
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
