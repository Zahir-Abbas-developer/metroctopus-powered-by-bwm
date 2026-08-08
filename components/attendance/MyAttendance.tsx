"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Plane } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { BreakControl } from "@/components/attendance/BreakControl";
import { OutagePanel } from "@/components/attendance/OutagePanel";
import { formatDuration, formatKarachiTime } from "@/lib/attendance-time";
import { cn } from "@/lib/utils";

type DayCell = {
  date: string;
  status: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  totalMinutes: number | null;
  autoClosed: boolean;
  checks: {
    id: string;
    status: string;
    scheduledAt: string;
    windowEndsAt: string;
    respondedAt: string | null;
    responseSeconds: number | null;
  }[];
  tally: { passed: number; missed: number; cancelled: number; resolved: number };
};

type MonthPayload = {
  period: { year: number; month: number };
  days: DayCell[];
  leave: { id: string; date: string; reason: string; status: string }[];
  stats: {
    attendanceRate: number | null;
    onTimeRate: number | null;
    checksPassed: number;
    checksTotal: number;
    checksRate: number | null;
    totalMinutes: number;
    presentDays: number;
    lateDays: number;
    absentDays: number;
    leaveDays: number;
  };
};

/** Status → colour. Green present, amber late, red absent, grey off or leave. */
const STATUS_STYLE: Record<string, string> = {
  PRESENT: "border-brand/25 bg-brand-tint text-brand",
  LATE: "border-warn/25 bg-warn-tint text-warn",
  ABSENT: "border-danger/25 bg-danger-tint text-danger",
  LEAVE: "border-line bg-cream text-ink/45",
  OFF: "border-line bg-cream/60 text-ink/30",
};

const STATUS_LABEL: Record<string, string> = {
  PRESENT: "Present",
  LATE: "Late",
  ABSENT: "Absent",
  LEAVE: "On leave",
  OFF: "Day off",
};

export function MyAttendance() {
  const toast = useToast();
  const now = new Date();

  const [period, setPeriod] = useState({
    year: Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric" }).format(now),
    ),
    month: Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", month: "2-digit" }).format(now),
    ),
  });

  const [data, setData] = useState<MonthPayload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(
        `/api/attendance/month?year=${period.year}&month=${period.month}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as MonthPayload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  const byDate = useMemo(
    () => new Map((data?.days ?? []).map((day) => [day.date, day])),
    [data],
  );

  const pendingLeave = useMemo(
    () => new Set((data?.leave ?? []).filter((l) => l.status === "PENDING").map((l) => l.date)),
    [data],
  );

  // A Monday-first grid, with blanks before the 1st.
  const grid = useMemo(() => {
    const first = new Date(Date.UTC(period.year, period.month - 1, 1));
    const daysInMonth = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate();
    const leading = (first.getUTCDay() + 6) % 7;

    const cells: (string | null)[] = Array.from({ length: leading }, () => null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      cells.push(
        `${period.year}-${String(period.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      );
    }
    return cells;
  }, [period]);

  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));

  const detail = selected ? byDate.get(selected) : null;

  function shift(delta: number) {
    setSelected(null);
    setPeriod((current) => {
      const month = current.month + delta;
      if (month < 1) return { year: current.year - 1, month: 12 };
      if (month > 12) return { year: current.year + 1, month: 1 };
      return { ...current, month };
    });
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Your record"
        title="My attendance"
        description="Your working days, and how the availability checks went. Everything is recorded in Karachi time."
        actions={
          <Button
            variant="secondary"
            icon={<Plane className="h-4 w-4" />}
            onClick={() => setLeaveOpen(true)}
          >
            Request leave
          </Button>
        }
      />

      {/* Protected time and outages sit above the calendar: they are things
          you do today, and the calendar is a record of what already happened. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <BreakControl onChange={() => void load()} />
        <OutagePanel onChange={() => void load()} />
      </div>

      {state === "loading" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[132px] rounded-card" />
            ))}
          </div>
          <Skeleton className="h-[420px] rounded-card" />
        </div>
      )}

      {state === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load your attendance"
            description="The month didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {state === "ready" && data && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Attendance"
              value={data.stats.attendanceRate ?? "—"}
              unit={data.stats.attendanceRate === null ? undefined : "%"}
              tone={
                data.stats.attendanceRate === null
                  ? "neutral"
                  : data.stats.attendanceRate >= 95
                    ? "success"
                    : data.stats.attendanceRate >= 85
                      ? "warning"
                      : "danger"
              }
              hint={`${data.stats.presentDays + data.stats.lateDays} of ${
                data.stats.presentDays + data.stats.lateDays + data.stats.absentDays
              } expected days worked`}
            />
            <StatCard
              label="On-time starts"
              value={data.stats.onTimeRate ?? "—"}
              unit={data.stats.onTimeRate === null ? undefined : "%"}
              tone={
                data.stats.onTimeRate === null
                  ? "neutral"
                  : data.stats.onTimeRate >= 90
                    ? "success"
                    : "warning"
              }
              hint={`${data.stats.lateDays} late start${data.stats.lateDays === 1 ? "" : "s"}`}
            />
            <StatCard
              label="Checks passed"
              value={data.stats.checksRate ?? "—"}
              unit={data.stats.checksRate === null ? undefined : "%"}
              tone={
                data.stats.checksRate === null
                  ? "neutral"
                  : data.stats.checksRate === 100
                    ? "success"
                    : data.stats.checksRate >= 90
                      ? "warning"
                      : "danger"
              }
              hint={`${data.stats.checksPassed} of ${data.stats.checksTotal} availability checks`}
            />
            <StatCard
              label="Hours worked"
              value={(data.stats.totalMinutes / 60).toFixed(1)}
              hint="Across the month"
            />
          </div>

          <Card padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
              <h2 className="font-display text-base font-bold tracking-tight text-ink">
                {monthLabel}
              </h2>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Previous month"
                  icon={<ChevronLeft className="h-4 w-4" />}
                  onClick={() => shift(-1)}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Next month"
                  icon={<ChevronRight className="h-4 w-4" />}
                  onClick={() => shift(1)}
                />
              </div>
            </div>

            <div className="p-5">
              <div className="mb-2 grid grid-cols-7 gap-2">
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
                  <p key={label} className="eyebrow text-center text-ink/35">
                    {label}
                  </p>
                ))}
              </div>

              <div className="grid grid-cols-7 gap-2">
                {grid.map((date, index) => {
                  if (!date) return <div key={`blank-${index}`} />;

                  const day = byDate.get(date);
                  const dayNumber = Number(date.slice(-2));
                  const style = day ? STATUS_STYLE[day.status] : "border-line bg-white";
                  const pending = pendingLeave.has(date);

                  return (
                    <button
                      key={date}
                      type="button"
                      onClick={() => setSelected(day ? date : null)}
                      disabled={!day}
                      className={cn(
                        "relative flex aspect-square flex-col items-center justify-center rounded-[10px] border transition-colors",
                        style,
                        day && "hover:border-ink/30",
                        !day && "text-ink/20",
                        selected === date && "ring-2 ring-brand/40",
                      )}
                    >
                      <span className="font-display text-sm font-bold tabular-nums">
                        {dayNumber}
                      </span>

                      {day && day.tally.resolved > 0 && (
                        <span className="mt-0.5 text-[10px] tabular-nums opacity-70">
                          {day.tally.passed}/{day.tally.resolved}
                        </span>
                      )}

                      {pending && (
                        <span
                          aria-label="Leave requested"
                          className="absolute right-1 top-1 h-1.5 w-1.5 rounded-pill bg-info"
                        />
                      )}
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
                {Object.entries(STATUS_LABEL).map(([status, label]) => (
                  <span key={status} className="flex items-center gap-1.5 text-[12px] text-ink/50">
                    <span
                      className={cn("h-2.5 w-2.5 rounded-[3px] border", STATUS_STYLE[status])}
                    />
                    {label}
                  </span>
                ))}
                <span className="flex items-center gap-1.5 text-[12px] text-ink/50">
                  <span className="h-1.5 w-1.5 rounded-pill bg-info" />
                  Leave requested
                </span>
              </div>
            </div>
          </Card>

          {detail && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow mb-1.5 text-brand">
                    {new Intl.DateTimeFormat("en-GB", {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                      timeZone: "UTC",
                    }).format(new Date(`${detail.date}T00:00:00.000Z`))}
                  </p>
                  <h3 className="font-display text-lg font-bold tracking-tight text-ink">
                    {STATUS_LABEL[detail.status] ?? detail.status}
                  </h3>
                </div>

                {detail.totalMinutes !== null && (
                  <Badge tone="neutral">{formatDuration(detail.totalMinutes)} worked</Badge>
                )}
              </div>

              {detail.clockInAt && (
                <p className="mt-3 text-[13px] text-ink/60">
                  {formatKarachiTime(new Date(detail.clockInAt))}
                  {detail.clockOutAt && ` – ${formatKarachiTime(new Date(detail.clockOutAt))}`}
                  {detail.autoClosed && " · closed automatically"}
                </p>
              )}

              <div className="mt-5">
                <p className="eyebrow mb-2 text-ink/40">Availability checks</p>

                {detail.checks.length === 0 ? (
                  <p className="text-[13px] text-ink/45">
                    No checks were recorded for this day.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {detail.checks.map((check) => (
                      <li
                        key={check.id}
                        className="flex items-center justify-between gap-3 rounded-[10px] border border-line bg-white px-3.5 py-2.5"
                      >
                        <span className="text-[13px] text-ink/70">
                          {formatKarachiTime(new Date(check.scheduledAt))}
                        </span>

                        <span className="flex items-center gap-2.5">
                          {check.responseSeconds !== null && (
                            <span className="text-[12px] text-ink/45">
                              answered in{" "}
                              {check.responseSeconds < 60
                                ? `${check.responseSeconds}s`
                                : `${Math.round(check.responseSeconds / 60)}m`}
                            </span>
                          )}
                          <Badge
                            size="sm"
                            tone={
                              check.status === "PASSED"
                                ? "success"
                                : check.status === "MISSED"
                                  ? "danger"
                                  : "neutral"
                            }
                          >
                            {check.status === "PASSED"
                              ? "Passed"
                              : check.status === "MISSED"
                                ? "Missed"
                                : "Cancelled"}
                          </Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          )}

          {data.leave.length > 0 && (
            <Card padded={false}>
              <div className="border-b border-line px-5 py-4">
                <h2 className="font-display text-base font-bold tracking-tight text-ink">
                  Leave requests
                </h2>
              </div>
              <ul className="divide-y divide-line">
                {data.leave.map((request) => (
                  <li key={request.id} className="flex items-start justify-between gap-3 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-ink">{request.date}</p>
                      <p className="mt-0.5 text-[12px] text-ink/55">{request.reason}</p>
                    </div>
                    <Badge
                      size="sm"
                      tone={
                        request.status === "APPROVED"
                          ? "success"
                          : request.status === "REJECTED"
                            ? "danger"
                            : "warning"
                      }
                    >
                      {request.status.charAt(0) + request.status.slice(1).toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {state === "ready" && data.days.length === 0 && (
            <Card padded={false}>
              <EmptyState
                icon={CalendarDays}
                eyebrow="Nothing yet"
                title="No attendance recorded this month"
                description="Your days appear here once you start clocking in."
              />
            </Card>
          )}
        </>
      )}

      <LeaveModal
        open={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        onSaved={() => {
          setLeaveOpen(false);
          toast.success("Leave requested — the owner has been notified.");
          void load();
        }}
      />
    </div>
  );
}

function LeaveModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDate("");
    setReason("");
    setErrors({});
  }, [open]);

  async function submit() {
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch("/api/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, reason }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't submit that request.");
        return;
      }

      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="sm"
      eyebrow="Time off"
      title="Request leave"
      description="Ask for a day off. Approved days create no availability checks and carry no penalty."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Send request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Date"
          type="date"
          requiredMark
          value={date}
          onChange={(event) => setDate(event.target.value)}
          error={errors.date}
          disabled={saving}
          hint="Today or later — leave can't be backdated."
        />
        <Textarea
          label="Reason"
          requiredMark
          rows={3}
          placeholder="Family commitment in the afternoon."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errors.reason}
          disabled={saving}
        />
      </div>
    </Modal>
  );
}
