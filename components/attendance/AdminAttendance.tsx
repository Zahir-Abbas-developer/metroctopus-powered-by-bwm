"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, FlaskConical, Users2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { LeaveInbox } from "@/components/attendance/LeaveInbox";
import { OutageInbox } from "@/components/attendance/OutageInbox";
import { AttendanceMatrix } from "@/components/attendance/AttendanceMatrix";
import { SettingsPanel } from "@/components/attendance/SettingsPanel";
import { useTicker } from "@/components/attendance/useAttendance";
import { formatDuration, formatKarachiClock, formatKarachiTime } from "@/lib/attendance-time";
import { cn } from "@/lib/utils";

type BoardRow = {
  id: string;
  name: string;
  jobTitle: string;
  avatarColor: string;
  dayKind: string;
  status: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  autoClosed: boolean;
  minutesWorked: number;
  checks: {
    total: number;
    passed: number;
    missed: number;
    active: number;
    pending: number;
    cancelled: number;
  };
  breaks: {
    onBreak: boolean;
    reason: string | null;
    usedMinutes: number;
    allowanceMinutes: number;
    exceeded: boolean;
  };
};

type Board = {
  serverNow: string;
  karachiMinutes: number;
  shift: { startMinutes: number; endMinutes: number; absentCutoffMinutes: number };
  summary: {
    total: number;
    working: number;
    notStarted: number;
    absent: number;
    onLeave: number;
    off: number;
  };
  rows: BoardRow[];
};

type Tab = "today" | "month" | "leave" | "outages" | "settings";

/**
 * The owner's attendance screen.
 *
 * "Today" is the one that matters day to day: who is actually working right
 * now. It refreshes on the same 60-second cadence as the members' own polling,
 * so what the owner sees is never more than a minute behind.
 */
export function AdminAttendance({ testTriggersEnabled }: { testTriggersEnabled: boolean }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("today");
  const [board, setBoard] = useState<Board | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);

  useTicker(1000);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/attendance/board", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      setBoard((await response.json()) as Board);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function trigger(userId: string, action: "TRIGGER_NEXT" | "EXPIRE_ACTIVE") {
    setBusyId(userId);
    try {
      const response = await fetch("/api/attendance/dev-trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, action }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success(
        action === "TRIGGER_NEXT"
          ? "Next check pulled forward — it's live now."
          : "Active check expired.",
      );
      await load();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Who's working"
        title="Attendance"
        description="The live picture of the day, the month's record, and the rules behind both."
      />

      <Tabs
        items={[
          { key: "today", label: "Today" },
          { key: "month", label: "Month" },
          { key: "leave", label: "Leave" },
          { key: "outages", label: "Outages" },
          { key: "settings", label: "Settings" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === "today" && (
        <>
          {state === "loading" && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <Skeleton key={index} className="h-[132px] rounded-card" />
                ))}
              </div>
              <Skeleton className="h-[320px] rounded-card" />
            </div>
          )}

          {state === "error" && (
            <Card padded={false}>
              <ErrorState
                title="Couldn't load the board"
                description="The live board didn't come back. This is usually temporary."
                onRetry={() => void load()}
              />
            </Card>
          )}

          {state === "ready" && board && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard
                  label="Working now"
                  value={board.summary.working}
                  icon={Users2}
                  tone={board.summary.working > 0 ? "success" : "neutral"}
                  hint={`of ${board.summary.total} team members`}
                />
                <StatCard
                  label="Not started"
                  value={board.summary.notStarted}
                  tone={board.summary.notStarted > 0 ? "warning" : "neutral"}
                  hint={`Clock-in closes ${formatKarachiClock(board.shift.absentCutoffMinutes)}`}
                />
                <StatCard
                  label="Absent"
                  value={board.summary.absent}
                  tone={board.summary.absent > 0 ? "danger" : "neutral"}
                  hint="No clock-in, no approved leave"
                />
                <StatCard
                  label="Off or on leave"
                  value={board.summary.off + board.summary.onLeave}
                  hint="No checks scheduled"
                />
              </div>

              <Card padded={false}>
                <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <div>
                    <h2 className="font-display text-base font-bold tracking-tight text-ink">
                      Live board
                    </h2>
                    <p className="mt-0.5 text-[13px] text-ink/50">
                      Karachi time {formatKarachiClock(board.karachiMinutes)} · refreshes
                      every minute
                    </p>
                  </div>
                </div>

                <ul className="divide-y divide-line">
                  {board.rows.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                      <Avatar name={row.name} color={row.avatarColor} size="md" />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{row.name}</p>
                        <p className="truncate text-[12px] text-ink/45">{row.jobTitle}</p>
                      </div>

                      <div className="w-32">
                        {row.clockInAt ? (
                          <>
                            <p className="text-[13px] font-medium text-ink tabular-nums">
                              {formatKarachiTime(new Date(row.clockInAt))}
                            </p>
                            <p className="text-[11px] text-ink/45">
                              {row.clockOutAt
                                ? `ended ${formatKarachiTime(new Date(row.clockOutAt))}`
                                : formatDuration(row.minutesWorked)}
                            </p>
                          </>
                        ) : (
                          <p
                            className={cn(
                              "text-[13px] font-medium",
                              row.status === "NOT_STARTED" || row.status === "ABSENT"
                                ? "text-danger"
                                : "text-ink/40",
                            )}
                          >
                            {row.status === "NOT_STARTED"
                              ? "not started"
                              : row.status === "ABSENT"
                                ? "absent"
                                : row.status === "LEAVE"
                                  ? "on leave"
                                  : "day off"}
                          </p>
                        )}
                      </div>

                      <div className="w-32">
                        {row.breaks.onBreak ? (
                          <Badge size="sm" tone="info" dot>
                            on break
                          </Badge>
                        ) : row.breaks.usedMinutes > 0 ? (
                          <span
                            className={cn(
                              "text-[12px] tabular-nums",
                              row.breaks.exceeded ? "text-warn" : "text-ink/45",
                            )}
                            title={`${row.breaks.usedMinutes} of ${row.breaks.allowanceMinutes} protected minutes used`}
                          >
                            {row.breaks.usedMinutes}/{row.breaks.allowanceMinutes} min
                          </span>
                        ) : (
                          <span className="text-[12px] text-ink/25">no breaks</span>
                        )}
                      </div>

                      <div className="w-40">
                        {row.checks.total === 0 ? (
                          <span className="text-[12px] text-ink/35">no checks</span>
                        ) : (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Badge
                              size="sm"
                              tone={row.checks.missed > 0 ? "danger" : "success"}
                            >
                              {row.checks.passed}/{row.checks.total} passed
                            </Badge>
                            {row.checks.active > 0 && (
                              <Badge size="sm" tone="warning" dot>
                                active
                              </Badge>
                            )}
                          </span>
                        )}
                      </div>

                      {testTriggersEnabled && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === row.id || row.checks.pending === 0}
                            onClick={() => void trigger(row.id, "TRIGGER_NEXT")}
                            title="Testing only: pull this member's next check forward"
                          >
                            Trigger
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busyId === row.id || row.checks.active === 0}
                            onClick={() => void trigger(row.id, "EXPIRE_ACTIVE")}
                            title="Testing only: expire the active check"
                            className="hover:text-danger"
                          >
                            Expire
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>

                {board.rows.length === 0 && (
                  <EmptyState
                    icon={Users2}
                    title="No team members"
                    description="Add people from the team page and their day appears here."
                  />
                )}
              </Card>

              {testTriggersEnabled && (
                <p className="flex items-center gap-2 rounded-card border border-warn/25 bg-warn-tint px-4 py-3 text-[12px] leading-relaxed text-warn">
                  <FlaskConical aria-hidden className="h-3.5 w-3.5 shrink-0" />
                  Test triggers are enabled on this deployment. They can manufacture
                  and dismiss checks, so unset ALLOW_TEST_TRIGGERS before real use.
                </p>
              )}
            </>
          )}
        </>
      )}

      {tab === "month" && <AttendanceMatrix />}
      {tab === "leave" && <LeaveInbox />}
      {tab === "outages" && <OutageInbox />}
      {tab === "settings" && <SettingsPanel />}
    </div>
  );
}
