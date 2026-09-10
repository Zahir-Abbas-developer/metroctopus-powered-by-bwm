"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, ListTodo, Plus } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { TaskFormModal } from "@/components/tasks/TaskFormModal";
import { FollowUpDialog } from "@/components/tasks/FollowUpDialog";
import { formatDate } from "@/lib/date";
import {
  TASK_PRIORITIES,
  TASK_PRIORITY_LABEL,
  TASK_PRIORITY_TONE,
  type TaskPriority,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

type TaskRow = {
  id: string;
  kind: "TASK" | "FOLLOW_UP";
  title: string;
  note: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: "OPEN" | "DONE";
  completedAt: string | null;
  bucket: "OVERDUE" | "TODAY" | "UPCOMING" | "COMPLETED";
  department: { id: string; shortLabel: string } | null;
  assignee: { id: string; name: string; avatarColor: string } | null;
  record: { id: string; name: string; type: "LEAD" | "CLIENT" } | null;
};

type Payload = {
  tasks: TaskRow[];
  timeZone: string;
  viewer: { id: string; isAdmin: boolean };
};

/** Order matters: what is late comes before what is due. */
const SECTIONS = [
  { key: "OVERDUE", title: "Overdue", tone: "danger" as const },
  { key: "TODAY", title: "Today", tone: "warning" as const },
  { key: "UPCOMING", title: "Upcoming", tone: "neutral" as const },
  { key: "COMPLETED", title: "Completed", tone: "success" as const },
] as const;

/**
 * Everything owed, in the order it is owed.
 *
 * Two kinds of row share these sections. A **task** is explicit — somebody
 * wrote it down. A **follow-up** is the record itself coming due, projected in
 * at read time rather than copied into the task table, so it can never drift
 * from the lead or client it describes.
 *
 * They behave differently for a reason: a task is finished with a checkbox, but
 * a follow-up cannot be, because "done" on a follow-up without saying what
 * happened or when to speak next is exactly how a lead goes quiet. It asks.
 */
export function TaskBoard() {
  const router = useRouter();
  const toast = useToast();

  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [mineOnly, setMineOnly] = useState(true);
  const [department, setDepartment] = useState("ALL");
  const [assignee, setAssignee] = useState("ALL");
  const [priority, setPriority] = useState("ALL");
  const [creating, setCreating] = useState(false);
  const [followUp, setFollowUp] = useState<TaskRow | null>(null);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (mineOnly) query.set("mine", "1");
      if (department !== "ALL") query.set("departmentId", department);
      if (!mineOnly && assignee !== "ALL") query.set("assigneeId", assignee);
      if (priority !== "ALL") query.set("priority", priority);

      const response = await fetch(`/api/tasks?${query}`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [mineOnly, department, assignee, priority]);

  useEffect(() => {
    void load();
  }, [load]);

  const departments = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of data?.tasks ?? []) {
      if (task.department) seen.set(task.department.id, task.department.shortLabel);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const assignees = useMemo(() => {
    const seen = new Map<string, string>();
    for (const task of data?.tasks ?? []) {
      if (task.assignee) seen.set(task.assignee.id, task.assignee.name);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  async function complete(task: TaskRow, done: boolean) {
    const previous = data;

    // Optimistic: the checkbox answers now and reverts if the server disagrees.
    setData((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((row) =>
              row.id === task.id
                ? { ...row, status: done ? "DONE" : "OPEN", bucket: done ? "COMPLETED" : "TODAY" }
                : row,
            ),
          }
        : current,
    );

    try {
      const response = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: done ? "DONE" : "OPEN" }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setData(previous);
        toast.error(body?.error ?? "Couldn't update that task.");
        return;
      }
      toast.success(done ? "Task completed." : "Task reopened.");
      await load();
    } catch {
      setData(previous);
      toast.error("We couldn't reach the server.");
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const section of SECTIONS) map.set(section.key, []);
    for (const task of data?.tasks ?? []) map.get(task.bucket)?.push(task);
    return map;
  }, [data]);

  const openCount = (data?.tasks ?? []).filter((task) => task.bucket !== "COMPLETED").length;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Daily work"
        title="Tasks"
        description="What you owe, what is late, and every follow-up coming due."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add task
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { key: true, label: "Mine" },
            { key: false, label: "Everyone" },
          ].map((option) => (
            <button
              key={String(option.key)}
              type="button"
              onClick={() => setMineOnly(option.key)}
              className={cn(
                "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                mineOnly === option.key
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-white text-ink/60 hover:border-ink/25 hover:text-ink",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        {departments.length > 1 && (
          <div className="w-full sm:w-48">
            <Select
              label="Department"
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              options={[
                { value: "ALL", label: "All departments" },
                ...departments.map(([id, label]) => ({ value: id, label })),
              ]}
            />
          </div>
        )}

        {!mineOnly && assignees.length > 1 && (
          <div className="w-full sm:w-48">
            <Select
              label="Assignee"
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              options={[
                { value: "ALL", label: "Everyone" },
                ...assignees.map(([id, name]) => ({ value: id, label: name })),
              ]}
            />
          </div>
        )}

        <div className="w-full sm:w-40">
          <Select
            label="Priority"
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            options={[
              { value: "ALL", label: "Any" },
              ...TASK_PRIORITIES.map((value) => ({
                value,
                label: TASK_PRIORITY_LABEL[value],
              })),
            ]}
          />
        </div>
      </div>

      {state === "loading" && (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-card" />
          <Skeleton className="h-24 rounded-card" />
        </div>
      )}

      {state === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load your tasks"
            description="This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {state === "ready" && openCount === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={CheckSquare}
            eyebrow="All clear"
            title="Nothing owed"
            description="No open tasks and no follow-ups due. Add one, or set a follow-up date on a lead."
            action={<Button onClick={() => setCreating(true)}>Add a task</Button>}
          />
        </Card>
      )}

      {state === "ready" &&
        SECTIONS.map((section) => {
          const rows = grouped.get(section.key) ?? [];
          if (rows.length === 0) return null;

          return (
            <section key={section.key}>
              <div className="mb-3 flex items-center gap-2.5">
                <h2 className="font-display text-base font-bold tracking-tight text-ink">
                  {section.title}
                </h2>
                <Badge tone={section.tone} size="sm">
                  {rows.length}
                </Badge>
              </div>

              <div className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
                {rows.map((task) => (
                  <div key={task.id} className="flex items-start gap-3 px-4 py-3">
                    {/* A follow-up has no checkbox: clearing it without saying
                        what happened is the failure this feature prevents. */}
                    {task.kind === "TASK" ? (
                      <input
                        type="checkbox"
                        aria-label={`Complete ${task.title}`}
                        checked={task.status === "DONE"}
                        onChange={(event) => void complete(task, event.target.checked)}
                        className="mt-1 h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
                      />
                    ) : (
                      <ListTodo aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-ink/30" />
                    )}

                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "text-sm text-ink",
                          task.status === "DONE" && "text-ink/45 line-through",
                        )}
                      >
                        {task.title}
                      </p>

                      {task.note && (
                        <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
                          {task.note}
                        </p>
                      )}

                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {task.dueAt && (
                          <span
                            className={cn(
                              "text-[12px]",
                              task.bucket === "OVERDUE" ? "text-danger" : "text-ink/45",
                            )}
                          >
                            {task.bucket === "OVERDUE" ? "Overdue · " : ""}
                            {formatDate(task.dueAt)}
                          </span>
                        )}

                        {task.department && (
                          <Badge size="sm" tone="neutral">
                            {task.department.shortLabel}
                          </Badge>
                        )}

                        {task.kind === "TASK" && (
                          <Badge size="sm" tone={TASK_PRIORITY_TONE[task.priority]}>
                            {TASK_PRIORITY_LABEL[task.priority]}
                          </Badge>
                        )}

                        {task.record && (
                          <button
                            type="button"
                            onClick={() =>
                              router.push(
                                task.record!.type === "LEAD"
                                  ? `/pipeline?lead=${task.record!.id}`
                                  : `/clients/${task.record!.id}`,
                              )
                            }
                            className="text-[12px] text-ink/55 underline-offset-2 hover:text-ink hover:underline"
                          >
                            {task.record.name}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {task.kind === "FOLLOW_UP" && task.bucket !== "COMPLETED" && (
                        <Button variant="ghost" size="sm" onClick={() => setFollowUp(task)}>
                          Log outcome
                        </Button>
                      )}
                      {task.assignee && (
                        <Avatar
                          name={task.assignee.name}
                          color={task.assignee.avatarColor}
                          size="sm"
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

      <TaskFormModal
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void load();
        }}
      />

      <FollowUpDialog
        row={followUp}
        onClose={() => setFollowUp(null)}
        onSaved={() => {
          setFollowUp(null);
          void load();
        }}
      />
    </div>
  );
}
