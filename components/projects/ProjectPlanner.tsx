"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FolderPlus,
  ListChecks,
  Plus,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { MilestoneModal } from "@/components/projects/MilestoneModal";
import { MilestoneRowItem, type MemberOption } from "@/components/projects/MilestoneRowItem";
import { RejectModal } from "@/components/projects/RejectModal";
import {
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  type ProjectStatus,
} from "@/lib/constants";
import { daysUntil, dueUrgency, formatDate, toDateInput } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { ModuleSection, MilestoneRow, ServiceSummary } from "@/lib/types";

export type ProjectHeaderData = {
  id: string;
  title: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  clientId: string;
  clientName: string;
  clientIndustry: string | null;
  services: ServiceSummary[];
};

export function ProjectPlanner({
  project,
  modules,
  members,
}: {
  project: ProjectHeaderData;
  modules: ModuleSection[];
  members: MemberOption[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<{ module: ModuleSection; milestone: MilestoneRow | null } | null>(
    null,
  );
  const [rejecting, setRejecting] = useState<MilestoneRow | null>(null);
  const [newWorkstream, setNewWorkstream] = useState<string | null>(null);

  const stats = useMemo(() => {
    const all = modules.flatMap((module) => module.milestones);
    const done = all.filter((milestone) => milestone.status === "COMPLETED").length;
    const overdue = all.filter(
      (milestone) =>
        milestone.status !== "COMPLETED" && dueUrgency(milestone.dueDate) === "overdue",
    ).length;
    const awaiting = all.filter((milestone) => milestone.status === "SUBMITTED").length;

    return {
      total: all.length,
      done,
      overdue,
      awaiting,
      percent: all.length === 0 ? 0 : Math.round((done / all.length) * 100),
    };
  }, [modules]);

  const daysRemaining = daysUntil(project.endDate);

  /** Every mutation funnels through here so errors surface in one place. */
  async function mutate(
    id: string,
    request: () => Promise<Response>,
    successMessage?: string,
  ): Promise<boolean> {
    setBusyId(id);
    setError(null);

    try {
      const response = await request();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error ?? "That didn't work. Please try again.");
        return false;
      }

      if (successMessage) setFlash(successMessage);
      router.refresh();
      return true;
    } catch {
      setError("We couldn't reach the server. Check your connection and retry.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  function reorder(module: ModuleSection, milestone: MilestoneRow, direction: -1 | 1) {
    const ids = module.milestones.map((item) => item.id);
    const from = ids.indexOf(milestone.id);
    const to = from + direction;
    if (to < 0 || to >= ids.length) return;

    [ids[from], ids[to]] = [ids[to], ids[from]];

    void mutate(milestone.id, () =>
      fetch("/api/milestones/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleId: module.id, ids }),
      }),
    );
  }

  return (
    <div className="space-y-8">
      <Link
        href={`/clients/${project.clientId}`}
        className="inline-flex items-center gap-1.5 text-[13px] text-ink/50 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        {project.clientName}
      </Link>

      {/* Dark editorial header */}
      <Card surface="dark" padded={false}>
        <div className="px-6 py-8 sm:px-9 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="eyebrow mb-3 text-brand-tint/70">{project.clientName}</p>
              <h1 className="font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] text-paper sm:text-[38px]">
                {project.title}
              </h1>
              <p className="mt-3 text-[15px] text-paper/55">
                {formatDate(project.startDate)} – {formatDate(project.endDate)}
              </p>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {project.services.map((service) => (
                  <span
                    key={service.id}
                    className="rounded-pill border border-paper/15 px-2.5 py-1 text-[11px] text-paper/60"
                  >
                    {service.name}
                  </span>
                ))}
              </div>
            </div>

            <div className="flex flex-col items-end gap-3">
              <Badge dot tone={PROJECT_STATUS_TONE[project.status]}>
                {PROJECT_STATUS_LABEL[project.status]}
              </Badge>
              <div className="text-right">
                <p className="font-display text-[40px] font-extrabold leading-none tracking-[-0.03em] text-paper">
                  {Math.abs(daysRemaining)}
                </p>
                <p className="eyebrow mt-1.5 text-paper/40">
                  {daysRemaining < 0 ? "days overdue" : "days remaining"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-8">
            <ProgressBar
              onDark
              value={stats.percent}
              showValue
              label={`${stats.done} of ${stats.total} milestones complete`}
              tone={stats.overdue > 0 ? "warn" : "brand"}
            />

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <HeaderStat label="Awaiting approval" value={stats.awaiting} tone="warn" />
              <HeaderStat label="Overdue" value={stats.overdue} tone="danger" />
              <HeaderStat label="Workstreams" value={modules.length} />
            </div>
          </div>
        </div>
      </Card>

      {flash && (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-card border border-brand/20 bg-brand-tint px-4 py-3 text-[13px] leading-relaxed text-brand"
        >
          <CheckCircle2 aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{flash}</span>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-card border border-danger/20 bg-danger-tint px-4 py-3 text-[13px] leading-relaxed text-danger"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Modules */}
      {modules.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            icon={ListChecks}
            eyebrow="Empty plan"
            title="No workstreams yet"
            description="This engagement has no modules. That usually means its services had no template — add milestones manually to get started."
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {modules.map((module) => {
            const done = module.milestones.filter((m) => m.status === "COMPLETED").length;

            return (
              <Card key={module.id} padded={false}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="font-display text-base font-bold tracking-tight text-ink">
                      {module.name}
                    </h2>
                    <p className="mt-0.5 text-[13px] text-ink/50">
                      {done} of {module.milestones.length} complete
                      {module.serviceName && ` · ${module.serviceName}`}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus className="h-3.5 w-3.5" />}
                      onClick={() => setEditing({ module, milestone: null })}
                    >
                      Add milestone
                    </Button>

                    {/* An empty workstream is removable; one with work is not,
                        since deleting would cascade through its milestones. */}
                    {module.milestones.length === 0 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove ${module.name}`}
                        icon={<Trash2 className="h-3.5 w-3.5" />}
                        onClick={() => {
                          void mutate(
                            module.id,
                            () => fetch(`/api/modules/${module.id}`, { method: "DELETE" }),
                            "Workstream removed.",
                          );
                        }}
                        className="hover:text-danger"
                      />
                    )}
                  </div>
                </div>

                {module.milestones.length === 0 ? (
                  <EmptyState
                    icon={ListChecks}
                    title="No milestones in this workstream"
                    description="Add the deliverables this service owes the client this month."
                    action={
                      <Button size="sm" onClick={() => setEditing({ module, milestone: null })}>
                        Add the first one
                      </Button>
                    }
                  />
                ) : (
                  <div className="divide-y divide-line">
                    {module.milestones.map((milestone, index) => (
                      <MilestoneRowItem
                        key={milestone.id}
                        milestone={milestone}
                        members={members}
                        busy={busyId === milestone.id}
                        isFirst={index === 0}
                        isLast={index === module.milestones.length - 1}
                        onEdit={() => setEditing({ module, milestone })}
                        onMove={(direction) => reorder(module, milestone, direction)}
                        onDelete={() => {
                          void mutate(
                            milestone.id,
                            () => fetch(`/api/milestones/${milestone.id}`, { method: "DELETE" }),
                            "Milestone removed.",
                          );
                        }}
                        onAssign={(assigneeId) => {
                          void mutate(milestone.id, () =>
                            fetch(`/api/milestones/${milestone.id}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ assigneeId }),
                            }),
                          );
                        }}
                        onApprove={() => {
                          void mutate(
                            milestone.id,
                            () =>
                              fetch(`/api/milestones/${milestone.id}/status`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "COMPLETED" }),
                              }),
                            `"${milestone.title}" approved — the score has been settled.`,
                          );
                        }}
                        onReject={() => setRejecting(milestone)}
                      />
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Add a workstream — the way a service with no built-in template, or
          any ad-hoc piece of work, gets a home in the plan. */}
      {newWorkstream === null ? (
        <button
          type="button"
          onClick={() => setNewWorkstream("")}
          className="flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-line px-5 py-4 text-[13px] text-ink/45 transition-colors hover:border-ink/25 hover:bg-cream/50 hover:text-ink"
        >
          <FolderPlus className="h-4 w-4" />
          Add a workstream
        </button>
      ) : (
        <div className="flex flex-wrap items-end gap-2.5 rounded-card border border-line bg-white p-4">
          <Input
            autoFocus
            label="Workstream name"
            placeholder="Email & SMS Marketing"
            value={newWorkstream}
            onChange={(event) => setNewWorkstream(event.target.value)}
            className="min-w-[200px]"
          />
          <Button
            onClick={() => {
              const name = newWorkstream.trim();
              if (name.length < 2) {
                setError("A workstream needs a name of at least 2 characters.");
                return;
              }
              void mutate(
                "new-module",
                () =>
                  fetch("/api/modules", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ projectId: project.id, name }),
                  }),
                "Workstream added.",
              ).then((ok) => {
                if (ok) setNewWorkstream(null);
              });
            }}
            loading={busyId === "new-module"}
          >
            Add
          </Button>
          <Button variant="ghost" onClick={() => setNewWorkstream(null)}>
            Cancel
          </Button>
        </div>
      )}

      {editing && (
        <MilestoneModal
          open
          moduleId={editing.module.id}
          moduleName={editing.module.name}
          milestone={editing.milestone}
          members={members}
          defaultDueDate={toDateInput(project.endDate)}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            setEditing(null);
            setFlash(message);
            router.refresh();
          }}
        />
      )}

      <RejectModal
        milestone={rejecting}
        onClose={() => setRejecting(null)}
        onConfirm={async (reason) => {
          if (!rejecting) return false;
          const ok = await mutate(
            rejecting.id,
            () =>
              fetch(`/api/milestones/${rejecting.id}/status`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "IN_PROGRESS", reason }),
              }),
            "Sent back for rework and the deduction recorded.",
          );
          if (ok) setRejecting(null);
          return ok;
        }}
      />
    </div>
  );
}

function HeaderStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "danger";
}) {
  return (
    <div className="rounded-[10px] border border-paper/10 bg-paper/[0.04] px-4 py-3">
      <p className="eyebrow text-paper/35">{label}</p>
      <p
        className={cn(
          "mt-1.5 font-display text-lg font-bold",
          value === 0 && "text-paper/50",
          value > 0 && tone === "warn" && "text-warn",
          value > 0 && tone === "danger" && "text-danger",
          value > 0 && !tone && "text-paper/85",
        )}
      >
        {value}
      </p>
    </div>
  );
}
