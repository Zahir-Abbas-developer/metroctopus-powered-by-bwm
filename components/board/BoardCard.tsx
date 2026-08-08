"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { WeightDots } from "@/components/ui/WeightDots";
import { dueUrgency, formatDate } from "@/lib/date";
import { BLOCK_REASON_LABEL, type BlockReason } from "@/lib/fairness-types";
import { effectiveDeadline } from "@/lib/scoring";
import { cn } from "@/lib/utils";
import type { BoardMilestone } from "@/components/board/BoardView";

/**
 * A milestone on the board.
 *
 * The drag handle is a separate target rather than the whole card, so clicking
 * the card opens its drawer and only the handle starts a drag. Making the
 * whole card draggable makes it fiddly to open one.
 */
export function BoardCard({
  milestone,
  onOpen,
  draggable,
  overlay = false,
}: {
  milestone: BoardMilestone;
  onOpen: () => void;
  draggable: boolean;
  /** Rendered inside the drag overlay rather than in a column. */
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: milestone.id, disabled: !draggable });

  const settled = milestone.status === "COMPLETED";
  const blocked = milestone.status === "BLOCKED";

  // A blocked card must never show an urgency colour. Its deadline has moved,
  // and a red chip on work the member cannot act on is the exact anxiety the
  // pause exists to remove.
  const urgency = settled || blocked ? "normal" : dueUrgency(milestone.dueDate);

  const shifted =
    milestone.blockedMinutes > 0
      ? effectiveDeadline(new Date(milestone.dueDate), milestone.blockedMinutes)
      : null;

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={
        overlay
          ? undefined
          : { transform: CSS.Transform.toString(transform), transition }
      }
      className={cn(
        "group rounded-card border p-3.5 transition-colors",
        // Muted, not alarming: a block is a paused clock, not a failure.
        blocked ? "border-dashed border-line bg-cream/50" : "bg-white",
        overlay
          ? "rotate-1 border-brand shadow-[0_14px_32px_-16px_rgba(12,12,10,0.5)]"
          : "border-line hover:border-ink/20",
        isDragging && !overlay && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {draggable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${milestone.title}`}
            className="-ml-1 cursor-grab touch-none rounded p-0.5 text-ink/20 opacity-0 transition-opacity hover:text-ink/50 focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
        >
          <span className="eyebrow block truncate text-ink/40">
            {milestone.clientName}
          </span>
          <span
            className={cn(
              "mt-1 block text-[13px] font-medium leading-snug text-ink",
              settled && "text-ink/55",
            )}
          >
            {milestone.title}
          </span>
        </button>
      </div>

      {blocked && milestone.blockedReason && (
        <p className="mt-2.5 flex flex-wrap items-center gap-1.5 pl-1">
          <span className="rounded-pill border border-line bg-white px-2 py-0.5 text-[10px] font-medium text-ink/60">
            {BLOCK_REASON_LABEL[milestone.blockedReason as BlockReason] ??
              milestone.blockedReason}
          </span>
          {milestone.blockedNote && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink/45">
              {milestone.blockedNote}
            </span>
          )}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 pl-1">
        <div className="flex items-center gap-2">
          <WeightDots weight={milestone.weight} />
          <span
            className={cn(
              "whitespace-nowrap rounded-pill border px-2 py-0.5 text-[11px] tabular-nums",
              urgency === "overdue" && "border-danger/25 bg-danger-tint font-medium text-danger",
              urgency === "soon" && "border-warn/25 bg-warn-tint font-medium text-warn",
              urgency === "normal" && "border-line bg-white text-ink/50",
            )}
          >
            {formatDate(milestone.dueDate)}
          </span>

          {shifted && (
            <span
              className="whitespace-nowrap rounded-pill border border-info/25 bg-info-tint px-2 py-0.5 text-[11px] tabular-nums text-info"
              title={`Deadline extended by blocked time to ${formatDate(shifted)}`}
            >
              → {formatDate(shifted)}
            </span>
          )}
        </div>

        {milestone.assignee ? (
          <Avatar
            name={milestone.assignee.name}
            color={milestone.assignee.avatarColor}
            size="sm"
            className="h-6 w-6 text-[9px]"
          />
        ) : (
          <span className="rounded-pill border border-dashed border-line px-2 py-0.5 text-[10px] text-ink/35">
            Unassigned
          </span>
        )}
      </div>
    </div>
  );
}
