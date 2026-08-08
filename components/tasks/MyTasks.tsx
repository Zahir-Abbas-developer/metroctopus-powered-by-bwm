"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarCheck,
  Clock,
  Flame,
  PartyPopper,
  Play,
  Send,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { MilestoneDrawer } from "@/components/board/MilestoneDrawer";
import { WeightDots } from "@/components/ui/WeightDots";
import {
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
  type MilestoneStatus,
} from "@/lib/constants";
import { daysUntil, dueUrgency, formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { MyTask } from "@/lib/types";

type Status = "loading" | "ready" | "error";

type Group = {
  key: "overdue" | "week" | "upcoming" | "done";
  title: string;
  description: string;
  tasks: MyTask[];
};

/**
 * A member's own work, grouped by deadline pressure rather than by project —
 * what's late, what's due this week, what's coming.
 *
 * Members move work PENDING -> IN_PROGRESS -> SUBMITTED. Approval is the
 * owner's, so there is deliberately no "mark complete" button here.
 */
export function MyTasks({
  isAdmin,
  viewerId,
}: {
  isAdmin: boolean;
  viewerId: string;
}) {
  const toast = useToast();
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/my-tasks", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = (await response.json()) as { milestones: MyTask[] };
      setTasks(body.milestones);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function move(task: MyTask, next: MilestoneStatus, message: string) {
    setBusyId(task.id);

    try {
      const response = await fetch(`/api/milestones/${task.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body?.error ?? "That didn't work. Please try again.");
        return;
      }

      toast.success(message);
      await load();
    } catch {
      toast.error("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setBusyId(null);
    }
  }

  const groups = useMemo<Group[]>(() => {
    const open = tasks.filter(
      (task) => task.status !== "COMPLETED" && task.status !== "MISSED",
    );
    const closed = tasks.filter(
      (task) => task.status === "COMPLETED" || task.status === "MISSED",
    );

    return [
      {
        key: "overdue",
        title: "Overdue",
        description: "Past their deadline. Every extra day costs more points.",
        tasks: open.filter((task) => dueUrgency(task.dueDate) === "overdue"),
      },
      {
        key: "week",
        title: "Due this week",
        description: "Landing in the next seven days.",
        tasks: open.filter((task) => {
          if (dueUrgency(task.dueDate) === "overdue") return false;
          return daysUntil(task.dueDate) <= 7;
        }),
      },
      {
        key: "upcoming",
        title: "Upcoming",
        description: "Further out — useful for planning your week.",
        tasks: open.filter((task) => {
          if (dueUrgency(task.dueDate) === "overdue") return false;
          return daysUntil(task.dueDate) > 7;
        }),
      },
      {
        key: "done",
        title: "Settled",
        description: "Approved or closed out.",
        tasks: closed,
      },
    ];
  }, [tasks]);

  /**
   * The three things to do next: overdue first, then nearest deadline, then
   * heaviest. Deliberately three — a "focus" list of ten is just a list.
   */
  const focus = useMemo(() => {
    return tasks
      .filter((task) => task.status !== "COMPLETED" && task.status !== "MISSED")
      .sort((a, b) => {
        const aOverdue = dueUrgency(a.dueDate) === "overdue" ? 0 : 1;
        const bOverdue = dueUrgency(b.dueDate) === "overdue" ? 0 : 1;
        if (aOverdue !== bOverdue) return aOverdue - bOverdue;

        const byDate = Date.parse(a.dueDate) - Date.parse(b.dueDate);
        if (byDate !== 0) return byDate;

        return b.weight - a.weight;
      })
      .slice(0, 3);
  }, [tasks]);

  const openCount = groups
    .filter((group) => group.key !== "done")
    .reduce((sum, group) => sum + group.tasks.length, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Your work"
        title="My tasks"
        description={
          isAdmin
            ? "Milestones assigned directly to you. Everything else lives on the project plans."
            : "Everything assigned to you, ordered by how close it is to its deadline."
        }
      />

      {status === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 rounded-card" />
          ))}
        </div>
      )}

      {status === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load your tasks"
            description="Your task list didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {status === "ready" && tasks.length === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={CalendarCheck}
            eyebrow="All clear"
            title="Nothing assigned to you"
            description={
              isAdmin
                ? "You have no milestones of your own. Open a project plan to see what the team is working on."
                : "When the owner plans this month's work, your milestones will appear here."
            }
          />
        </Card>
      )}

      {status === "ready" && focus.length > 0 && (
        <section>
          <div className="mb-3">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-ink">
              <Flame className="h-4 w-4 text-danger" />
              Focus today
            </h2>
            <p className="mt-0.5 text-[13px] text-ink/50">
              The {focus.length === 1 ? "one thing" : `${focus.length} things`} to
              deal with before anything else.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {focus.map((task, index) => {
              const urgency = dueUrgency(task.dueDate);

              return (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => setOpenId(task.id)}
                  className={cn(
                    "flex flex-col rounded-card border bg-white p-4 text-left transition-colors hover:border-ink/25",
                    urgency === "overdue" ? "border-danger/30" : "border-line",
                  )}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="eyebrow text-ink/40">{task.clientName}</span>
                    <span className="font-display text-[11px] font-bold text-ink/25">
                      {index + 1}
                    </span>
                  </span>

                  <span className="mt-2 flex-1 text-[13px] font-medium leading-snug text-ink">
                    {task.title}
                  </span>

                  <span className="mt-3 flex items-center justify-between gap-2">
                    <span
                      className={cn(
                        "rounded-pill border px-2 py-0.5 text-[11px]",
                        urgency === "overdue" && "border-danger/25 bg-danger-tint font-medium text-danger",
                        urgency === "soon" && "border-warn/25 bg-warn-tint font-medium text-warn",
                        urgency === "normal" && "border-line bg-white text-ink/50",
                      )}
                    >
                      {urgency === "overdue" ? "Overdue" : formatDate(task.dueDate)}
                    </span>
                    <WeightDots weight={task.weight} />
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {status === "ready" && tasks.length > 0 && openCount === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={PartyPopper}
            eyebrow="Inbox zero"
            title="Nothing open right now"
            description="Everything assigned to you is settled. Your finished work is listed below."
          />
        </Card>
      )}

      {status === "ready" &&
        groups.map((group) => {
          if (group.tasks.length === 0) return null;

          return (
            <section key={group.key}>
              <div className="mb-3 flex items-baseline justify-between gap-4">
                <div>
                  <h2 className="font-display text-lg font-bold tracking-tight text-ink">
                    {group.title}
                    <span
                      className={cn(
                        "ml-2 rounded-pill px-2 py-0.5 text-[12px] font-medium tabular-nums",
                        group.key === "overdue"
                          ? "bg-danger-tint text-danger"
                          : "bg-cream text-ink/50",
                      )}
                    >
                      {group.tasks.length}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-[13px] text-ink/50">{group.description}</p>
                </div>
              </div>

              <div className="space-y-2.5">
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    canOpenProject={isAdmin}
                    busy={busyId === task.id}
                    onStart={() => move(task, "IN_PROGRESS", `Started "${task.title}".`)}
                    onSubmit={() =>
                      move(task, "SUBMITTED", `"${task.title}" submitted for approval.`)
                    }
                    onOpen={() => setOpenId(task.id)}
                  />
                ))}
              </div>
            </section>
          );
        })}

      <MilestoneDrawer
        milestoneId={openId}
        viewerId={viewerId}
        viewerRole={isAdmin ? "ADMIN" : "MEMBER"}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

function TaskCard({
  task,
  canOpenProject,
  busy,
  onStart,
  onSubmit,
  onOpen,
}: {
  task: MyTask;
  /** Project plans are owner-only, so members get the title as plain text. */
  canOpenProject: boolean;
  busy: boolean;
  onStart: () => void;
  onSubmit: () => void;
  onOpen: () => void;
}) {
  const settled = task.status === "COMPLETED" || task.status === "MISSED";
  const urgency = settled ? "normal" : dueUrgency(task.dueDate);

  return (
    <div
      className={cn(
        "rounded-card border bg-white p-4 transition-colors sm:p-5",
        busy && "opacity-60",
        urgency === "overdue" ? "border-danger/30" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="eyebrow mb-1.5 text-ink/40">
            {task.clientName} · {task.moduleName}
          </p>
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "text-left text-[15px] font-medium text-ink transition-colors hover:text-brand",
              settled && "text-ink/55",
            )}
          >
            {task.title}
          </button>
          {task.description && (
            <p className="mt-1 text-[13px] leading-relaxed text-ink/50">{task.description}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12px]",
                urgency === "overdue" && "border-danger/25 bg-danger-tint font-medium text-danger",
                urgency === "soon" && "border-warn/25 bg-warn-tint font-medium text-warn",
                urgency === "normal" && "border-line bg-white text-ink/55",
              )}
            >
              <Clock aria-hidden className="h-3 w-3" />
              {formatDate(task.dueDate)}
              {!settled && urgency === "overdue" && " · overdue"}
              {!settled && urgency === "soon" && " · due soon"}
            </span>

            <Badge dot tone={MILESTONE_STATUS_TONE[task.status]} size="sm">
              {MILESTONE_STATUS_LABEL[task.status]}
            </Badge>

            <span className="flex items-center gap-1.5 text-[12px] text-ink/40">
              <WeightDots weight={task.weight} />
              weight {task.weight}
            </span>

            {canOpenProject ? (
              <Link
                href={`/projects/${task.projectId}`}
                className="text-[12px] text-ink/40 underline-offset-2 hover:text-ink/70 hover:underline"
              >
                {task.projectTitle}
              </Link>
            ) : (
              <span className="text-[12px] text-ink/40">{task.projectTitle}</span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {task.status === "PENDING" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onStart} icon={<Play className="h-3.5 w-3.5" />}>
              Start
            </Button>
          )}

          {task.status === "IN_PROGRESS" && (
            <Button size="sm" disabled={busy} onClick={onSubmit} icon={<Send className="h-3.5 w-3.5" />}>
              Submit
            </Button>
          )}

          {task.status === "SUBMITTED" && (
            <span className="rounded-pill border border-warn/25 bg-warn-tint px-3 py-1.5 text-[12px] font-medium text-warn">
              Awaiting approval
            </span>
          )}

          {task.status === "MISSED" && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onStart}>
              Reopen
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
