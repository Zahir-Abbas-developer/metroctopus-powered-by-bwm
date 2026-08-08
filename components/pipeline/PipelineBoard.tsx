"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { Plus, Target, TrendingUp, Trophy, Wallet } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "@/components/ui/StatCard";
import { useToast } from "@/components/ui/Toast";
import { LeadCard } from "@/components/pipeline/LeadCard";
import { LeadDrawer } from "@/components/pipeline/LeadDrawer";
import { LeadFormModal } from "@/components/pipeline/LeadFormModal";
import { LostDialog } from "@/components/pipeline/LostDialog";
import { DropColumn } from "@/components/pipeline/DropColumn";
import {
  OPEN_STAGES,
  STAGE_LABEL,
  formatMoney,
  type LeadStage,
} from "@/lib/pipeline-types";

export type PipelineLead = {
  id: string;
  businessName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  source: string;
  country: string | null;
  interestedServices: string[];
  estimatedMonthlyValue: number;
  stage: LeadStage;
  stageChangedAt: string;
  lostReason: string | null;
  lostNote: string | null;
  owner: { id: string; name: string; avatarColor: string } | null;
  activityCount: number;
  convertedClientId: string | null;
  createdAt: string;
};

type Payload = {
  metrics: {
    stages: { stage: LeadStage; count: number; value: number }[];
    openValue: number;
    openCount: number;
    wonThisMonth: { count: number; value: number };
    winRate: number | null;
    averageDealSize: number | null;
  };
  owners: { id: string; name: string; avatarColor: string }[];
  services: { slug: string; name: string }[];
  viewer: { id: string; isAdmin: boolean };
  leads: PipelineLead[];
};

/**
 * The pipeline.
 *
 * Same kanban idiom as the delivery board, so nothing has to be learned twice
 * — but with money at the top of every column, because a stage with four
 * $2k deals in it and a stage with one $30k deal in it are not the same
 * pipeline and a card count says they are.
 */
export function PipelineBoard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [owner, setOwner] = useState("ALL");
  const [dragging, setDragging] = useState<PipelineLead | null>(null);
  const [creating, setCreating] = useState(false);
  const [losing, setLosing] = useState<PipelineLead | null>(null);

  const openId = searchParams.get("lead");

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/leads${owner !== "ALL" ? `?ownerId=${owner}` : ""}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [owner]);

  useEffect(() => {
    void load();
  }, [load]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  const byStage = useMemo(() => {
    const map = new Map<LeadStage, PipelineLead[]>();
    for (const stage of OPEN_STAGES) map.set(stage, []);
    for (const lead of data?.leads ?? []) {
      if (!map.has(lead.stage)) continue;
      map.get(lead.stage)!.push(lead);
    }
    return map;
  }, [data]);

  async function commitStage(lead: PipelineLead, stage: LeadStage, extra?: Record<string, unknown>) {
    const previous = data;

    // Optimistic: the card moves now and snaps back if the server disagrees.
    setData((current) =>
      current
        ? {
            ...current,
            leads: current.leads.map((row) =>
              row.id === lead.id ? { ...row, stage } : row,
            ),
          }
        : current,
    );

    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage, ...extra }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setData(previous);
        toast.error(body?.error ?? "Couldn't move that.");
        return false;
      }

      if (stage === "WON") {
        toast.success(`${lead.businessName} won. Convert them from the card when you're ready.`);
      }
      await load();
      return true;
    } catch {
      setData(previous);
      toast.error("We couldn't reach the server.");
      return false;
    }
  }

  function onDragEnd(event: DragEndEvent) {
    setDragging(null);
    const { active, over } = event;
    if (!over || !data) return;

    const lead = data.leads.find((row) => row.id === active.id);
    if (!lead) return;

    const target = (
      [...OPEN_STAGES, "WON", "LOST"] as string[]
    ).includes(String(over.id))
      ? (String(over.id) as LeadStage)
      : data.leads.find((row) => row.id === over.id)?.stage;

    if (!target || target === lead.stage) return;

    if (!data.viewer.isAdmin && lead.owner?.id !== data.viewer.id) {
      toast.error("You can only move leads you own.");
      return;
    }

    // LOST needs a reason before anything moves — the reason is the point.
    if (target === "LOST") {
      setLosing(lead);
      return;
    }

    void commitStage(lead, target);
  }

  const metrics = data?.metrics;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="New business"
        title="Pipeline"
        description="Every live deal, what it's worth, and what's been done about it."
        actions={
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Add lead
          </Button>
        }
      />

      {state === "loading" && (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-[132px] rounded-card" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-5">
            {OPEN_STAGES.map((stage) => (
              <Skeleton key={stage} className="h-[320px] rounded-card" />
            ))}
          </div>
        </div>
      )}

      {state === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load the pipeline"
            description="This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {state === "ready" && data && metrics && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label="Open pipeline"
              value={formatMoney(metrics.openValue, true)}
              icon={Wallet}
              tone="info"
              hint={`${metrics.openCount} live deal${metrics.openCount === 1 ? "" : "s"} · monthly value`}
            />
            <StatCard
              label="Won this month"
              value={formatMoney(metrics.wonThisMonth.value, true)}
              icon={Trophy}
              tone={metrics.wonThisMonth.count > 0 ? "success" : "neutral"}
              hint={`${metrics.wonThisMonth.count} deal${metrics.wonThisMonth.count === 1 ? "" : "s"} closed`}
            />
            <StatCard
              label="Win rate"
              value={metrics.winRate === null ? "—" : metrics.winRate}
              unit={metrics.winRate === null ? undefined : "%"}
              icon={Target}
              tone={
                metrics.winRate === null
                  ? "neutral"
                  : metrics.winRate >= 40
                    ? "success"
                    : metrics.winRate >= 20
                      ? "warning"
                      : "danger"
              }
              hint="Of deals closed this month, won or lost"
            />
            <StatCard
              label="Average deal"
              value={
                metrics.averageDealSize === null
                  ? "—"
                  : formatMoney(metrics.averageDealSize, true)
              }
              icon={TrendingUp}
              hint="Across every deal ever won"
            />
          </div>

          {data.owners.length > 1 && (
            <div className="max-w-[240px]">
              <Select
                label="Owner"
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
                options={[
                  { value: "ALL", label: "Everyone" },
                  ...data.owners.map((person) => ({ value: person.id, label: person.name })),
                ]}
              />
            </div>
          )}

          {data.leads.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={Wallet}
                eyebrow="Nothing in play"
                title="No live deals"
                description="Add a lead and it appears here. Everything logged against it counts towards weekly activity targets."
                action={<Button onClick={() => setCreating(true)}>Add the first lead</Button>}
              />
            </Card>
          ) : (
            <DndContext
              sensors={sensors}
              onDragStart={(event: DragStartEvent) =>
                setDragging(data.leads.find((row) => row.id === event.active.id) ?? null)
              }
              onDragEnd={onDragEnd}
            >
              <div className="grid gap-4 lg:grid-cols-5">
                {OPEN_STAGES.map((stage) => {
                  const leads = byStage.get(stage) ?? [];
                  const value = leads.reduce(
                    (sum, lead) => sum + lead.estimatedMonthlyValue,
                    0,
                  );

                  return (
                    <DropColumn
                      key={stage}
                      id={stage}
                      title={STAGE_LABEL[stage]}
                      count={leads.length}
                      value={value}
                    >
                      <SortableContext
                        items={leads.map((lead) => lead.id)}
                        strategy={verticalListSortingStrategy}
                      >
                        {leads.map((lead) => (
                          <LeadCard
                            key={lead.id}
                            lead={lead}
                            draggable={data.viewer.isAdmin || lead.owner?.id === data.viewer.id}
                            onOpen={() => router.push(`/pipeline?lead=${lead.id}`)}
                          />
                        ))}
                      </SortableContext>
                    </DropColumn>
                  );
                })}
              </div>

              {/* Closed lanes sit below the funnel rather than inside it: they
                  are outcomes, not stages you work a deal through. */}
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <DropColumn id="WON" title="Won" count={0} value={0} tone="success" compact />
                <DropColumn id="LOST" title="Lost" count={0} value={0} tone="danger" compact />
              </div>

              <DragOverlay>
                {dragging && <LeadCard lead={dragging} draggable onOpen={() => {}} overlay />}
              </DragOverlay>
            </DndContext>
          )}
        </>
      )}

      <LeadFormModal
        open={creating}
        services={data?.services ?? []}
        owners={data?.owners ?? []}
        canAssign={data?.viewer.isAdmin ?? false}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void load();
        }}
      />

      <LostDialog
        lead={losing}
        onClose={() => setLosing(null)}
        onConfirm={async (reason, note) => {
          if (!losing) return;
          const ok = await commitStage(losing, "LOST", { lostReason: reason, lostNote: note });
          if (ok) setLosing(null);
        }}
      />

      <LeadDrawer
        leadId={openId}
        onClose={() => router.push("/pipeline")}
        onChanged={() => void load()}
      />
    </div>
  );
}
