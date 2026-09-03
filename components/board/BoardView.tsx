"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanSquare, Lock } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { BoardCard } from "@/components/board/BoardCard";
import { MilestoneDrawer } from "@/components/board/MilestoneDrawer";
import {
  MILESTONE_STATUS_LABEL,
  canTransition,
  type MilestoneStatus,
  type Role, hasAdminPower } from "@/lib/constants";
import { cn } from "@/lib/utils";

export type BoardMilestone = {
  id: string;
  title: string;
  status: MilestoneStatus;
  weight: number;
  dueDate: string;
  assignee: { id: string; name: string; avatarColor: string } | null;
  moduleName: string;
  projectId: string;
  projectTitle: string;
  clientName: string;
  serviceId: string | null;
  blockedReason: string | null;
  blockedNote: string | null;
  blockedSince: string | null;
  /** Total paused minutes, including any block still running. */
  blockedMinutes: number;
};

type Filters = {
  projects: { id: string; label: string }[];
  services: { id: string; label: string }[];
  members: { id: string; name: string; avatarColor: string }[];
};

type Status = "loading" | "ready" | "error";

/**
 * Blocked sits between "in progress" and "submitted" because that is where it
 * happens: work someone started and then hit a wall on. It is deliberately not
 * a drop target — the block clock needs a reason and a note, so entering and
 * leaving it goes through the drawer. `canTransition` returns false for it in
 * both directions, which is what greys the column out mid-drag.
 */
const COLUMNS: MilestoneStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "BLOCKED",
  "SUBMITTED",
  "COMPLETED",
];

export function BoardView({ role, userId }: { role: Role; userId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [milestones, setMilestones] = useState<BoardMilestone[]>([]);
  const [filters, setFilters] = useState<Filters>({ projects: [], services: [], members: [] });
  const [status, setStatus] = useState<Status>("loading");
  const [dragging, setDragging] = useState<BoardMilestone | null>(null);

  const [project, setProject] = useState("ALL");
  const [member, setMember] = useState("ALL");
  const [service, setService] = useState("ALL");

  // Deep links from search and notifications land here with ?milestone=<id>.
  const [openId, setOpenId] = useState<string | null>(
    () => searchParams.get("milestone"),
  );

  const isAdmin = hasAdminPower(role);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/board", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = (await response.json()) as {
        milestones: BoardMilestone[];
        filters: Filters;
      };
      setMilestones(body.milestones);
      setFilters(body.filters);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sensors = useSensors(
    // A few pixels of travel before a drag starts, so a click still reads as
    // a click on a touchpad.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const visible = useMemo(
    () =>
      milestones.filter((milestone) => {
        if (project !== "ALL" && milestone.projectId !== project) return false;
        if (member !== "ALL" && milestone.assignee?.id !== member) return false;
        if (service !== "ALL" && milestone.serviceId !== service) return false;
        return true;
      }),
    [milestones, project, member, service],
  );

  const byColumn = useMemo(() => {
    const map = new Map<MilestoneStatus, BoardMilestone[]>();
    for (const column of COLUMNS) map.set(column, []);
    for (const milestone of visible) {
      // MISSED has no column of its own; it sits with the unfinished work.
      const column: MilestoneStatus =
        milestone.status === "MISSED" ? "PENDING" : milestone.status;
      map.get(column)?.push(milestone);
    }
    return map;
  }, [visible]);

  function onDragStart(event: DragStartEvent) {
    const found = milestones.find((m) => m.id === event.active.id);
    setDragging(found ?? null);
  }

  async function onDragEnd(event: DragEndEvent) {
    setDragging(null);

    const { active, over } = event;
    if (!over) return;

    const milestone = milestones.find((m) => m.id === active.id);
    if (!milestone) return;

    // Dropping on a card means "this column", not "this position".
    const target = (COLUMNS.includes(over.id as MilestoneStatus)
      ? over.id
      : milestones.find((m) => m.id === over.id)?.status) as MilestoneStatus | undefined;

    if (!target || target === milestone.status) return;

    // The same rules the API enforces, checked here so the card doesn't move
    // and snap back.
    if (!canTransition(role, milestone.status, target)) {
      toast.error(
        target === "BLOCKED"
          ? "Open the milestone to block it — a block needs a reason and a note."
          : milestone.status === "BLOCKED"
            ? "Open the milestone to unblock it, so the paused time is banked."
            : role === "MEMBER" && target === "COMPLETED"
              ? "Only the agency owner can approve work."
              : `A milestone can't move from ${MILESTONE_STATUS_LABEL[milestone.status]} to ${MILESTONE_STATUS_LABEL[target]}.`,
      );
      return;
    }

    const previous = milestones;
    setMilestones((current) =>
      current.map((m) => (m.id === milestone.id ? { ...m, status: target } : m)),
    );

    try {
      const response = await fetch(`/api/milestones/${milestone.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setMilestones(previous);
        toast.error(body?.error ?? "That move didn't stick.");
        return;
      }

      toast.success(
        `"${milestone.title}" moved to ${MILESTONE_STATUS_LABEL[target]}.`,
      );
      void load();
      router.refresh();
    } catch {
      setMilestones(previous);
      toast.error("We couldn't reach the server. Check your connection.");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        title="Board"
        description={
          isAdmin
            ? "Every milestone across the agency. Drag a card to move it; approvals stay yours alone."
            : "Your work, by stage. Move a card as you go — the owner approves the last step."
        }
      />

      {status === "ready" && milestones.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Project"
            options={[
              { value: "ALL", label: "All projects" },
              ...filters.projects.map((p) => ({ value: p.id, label: p.label })),
            ]}
            value={project}
            onChange={(event) => setProject(event.target.value)}
          />
          {isAdmin ? (
            <Select
              label="Member"
              options={[
                { value: "ALL", label: "Everyone" },
                ...filters.members.map((m) => ({ value: m.id, label: m.name })),
              ]}
              value={member}
              onChange={(event) => setMember(event.target.value)}
            />
          ) : (
            <div className="flex items-end">
              <p className="flex items-center gap-2 pb-3 text-[13px] text-ink/45">
                <Lock className="h-3.5 w-3.5" />
                Showing only your milestones
              </p>
            </div>
          )}
          <Select
            label="Service"
            options={[
              { value: "ALL", label: "All services" },
              ...filters.services.map((s) => ({ value: s.id, label: s.label })),
            ]}
            value={service}
            onChange={(event) => setService(event.target.value)}
          />
        </div>
      )}

      {status === "loading" && (
        <div className="grid gap-4 lg:grid-cols-5">
          {COLUMNS.map((column) => (
            <div key={column} className="space-y-3">
              <Skeleton className="h-9 rounded-[10px]" />
              {Array.from({ length: 3 }).map((_, index) => (
                <Skeleton key={index} className="h-28 rounded-card" />
              ))}
            </div>
          ))}
        </div>
      )}

      {status === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load the board"
            description="The board didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {status === "ready" && milestones.length === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={KanbanSquare}
            eyebrow="Nothing here"
            title={isAdmin ? "No milestones yet" : "Nothing assigned to you"}
            description={
              isAdmin
                ? "Onboard a client and their plan will fill this board automatically."
                : "When the owner plans this month's work, your milestones appear here."
            }
          />
        </Card>
      )}

      {status === "ready" && milestones.length > 0 && (
        <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
          <div className="grid gap-4 lg:grid-cols-5">
            {COLUMNS.map((column) => (
              <Column
                key={column}
                status={column}
                milestones={byColumn.get(column) ?? []}
                canDropHere={dragging ? canTransition(role, dragging.status, column) : true}
                isDragging={Boolean(dragging)}
                role={role}
                onOpen={setOpenId}
              />
            ))}
          </div>

          <DragOverlay>
            {dragging && (
              <BoardCard milestone={dragging} onOpen={() => {}} draggable overlay />
            )}
          </DragOverlay>
        </DndContext>
      )}

      <MilestoneDrawer
        milestoneId={openId}
        viewerId={userId}
        viewerRole={role}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          void load();
          router.refresh();
        }}
      />
    </div>
  );
}

function Column({
  status,
  milestones,
  canDropHere,
  isDragging,
  role,
  onOpen,
}: {
  status: MilestoneStatus;
  milestones: BoardMilestone[];
  canDropHere: boolean;
  isDragging: boolean;
  role: Role;
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      className={cn(
        "flex min-h-[220px] flex-col rounded-card border p-3 transition-colors",
        isOver && canDropHere ? "border-brand bg-brand-tint/40" : "border-line bg-cream/50",
        // A column that would reject the drop says so before it is attempted.
        isDragging && !canDropHere && "opacity-45",
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <h2 className="eyebrow text-ink/50">{MILESTONE_STATUS_LABEL[status]}</h2>
        <span className="font-display text-[13px] font-bold tabular-nums text-ink/35">
          {milestones.length}
        </span>
      </div>

      <SortableContext
        items={milestones.map((m) => m.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2.5">
          {milestones.length === 0 ? (
            <p className="rounded-[10px] border border-dashed border-line px-3 py-6 text-center text-[12px] text-ink/35">
              {isDragging && !canDropHere ? "Not allowed here" : "Nothing here"}
            </p>
          ) : (
            milestones.map((milestone) => (
              <BoardCard
                key={milestone.id}
                milestone={milestone}
                draggable={canTransition(role, milestone.status, "IN_PROGRESS") ||
                  hasAdminPower(role)}
                onOpen={() => onOpen(milestone.id)}
              />
            ))
          )}
        </div>
      </SortableContext>
    </section>
  );
}
