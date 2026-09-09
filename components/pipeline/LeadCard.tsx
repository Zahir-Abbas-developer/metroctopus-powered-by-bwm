"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, MessageSquare } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { formatMoney, LEAD_SOURCE_LABEL, type LeadSource } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";
import type { PipelineLead } from "@/components/pipeline/PipelineBoard";

/**
 * A deal on the board.
 *
 * Carries the days-in-stage figure because a deal that has sat in NEGOTIATION
 * for three weeks looks identical to one that arrived this morning, and only
 * one of them needs a call today.
 */
export function LeadCard({
  lead,
  onOpen,
  draggable,
  overlay = false,
}: {
  lead: PipelineLead;
  onOpen: () => void;
  draggable: boolean;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: lead.id, disabled: !draggable });

  const days = Math.floor(
    (Date.now() - new Date(lead.stageChangedAt).getTime()) / 86_400_000,
  );

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      style={
        overlay ? undefined : { transform: CSS.Transform.toString(transform), transition }
      }
      className={cn(
        "group rounded-card border bg-white p-3 transition-colors",
        overlay
          ? "rotate-1 border-brand shadow-[0_14px_32px_-16px_rgba(12,12,10,0.5)]"
          : "border-line hover:border-ink/20",
        isDragging && !overlay && "opacity-40",
      )}
    >
      <div className="flex items-start gap-1.5">
        {draggable && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Drag ${lead.businessName}`}
            className="-ml-1 cursor-grab touch-none rounded p-0.5 text-ink/20 opacity-0 transition-opacity hover:text-ink/50 focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        )}

        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <span className="block truncate text-[13px] font-medium leading-snug text-ink">
            {lead.businessName}
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-ink/45">
            {lead.contactName}
            {lead.country ? ` · ${lead.country}` : ""}
          </span>
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 pl-1">
        {/* Money is absent, not zero, for viewers the server strips it from —
            rendering formatMoney(undefined) is how a card threw for every
            non-owner. What the deal is worth leads; the monthly figure is the
            fallback for a lead priced before dealValue existed. */}
        {lead.dealValue !== undefined && lead.dealValue > 0 ? (
          <span className="font-display text-sm font-bold tabular-nums text-ink">
            {formatMoney(lead.dealValue, true)}
          </span>
        ) : lead.estimatedMonthlyValue !== undefined ? (
          <span className="font-display text-sm font-bold tabular-nums text-ink">
            {formatMoney(lead.estimatedMonthlyValue, true)}
            <span className="ml-0.5 text-[11px] font-medium text-ink/35">/mo</span>
          </span>
        ) : (
          <span />
        )}

        {lead.owner && (
          <Avatar
            name={lead.owner.name}
            color={lead.owner.avatarColor}
            size="sm"
            className="h-6 w-6 text-[9px]"
          />
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 pl-1 text-[11px] text-ink/40">
        <span className="rounded-pill border border-line px-1.5 py-0.5">
          {LEAD_SOURCE_LABEL[lead.source as LeadSource] ?? lead.source}
        </span>

        {lead.activityCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="h-3 w-3" />
            {lead.activityCount}
          </span>
        )}

        <span
          className={cn("tabular-nums", days >= 14 && "font-medium text-warn")}
          title={`In this stage since ${new Date(lead.stageChangedAt).toDateString()}`}
        >
          {days === 0 ? "today" : `${days}d`}
        </span>
      </div>
    </div>
  );
}
