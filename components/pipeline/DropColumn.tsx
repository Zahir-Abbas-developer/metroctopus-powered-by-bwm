"use client";

import type { ReactNode } from "react";
import { useDroppable } from "@dnd-kit/core";

import { formatMoney } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";

/**
 * A pipeline column.
 *
 * The money total sits in the header at the same weight as the stage name,
 * because "4 deals" and "$18k" answer different questions and only one of them
 * is the one the owner is asking.
 */
export function DropColumn({
  id,
  title,
  count,
  value,
  children,
  tone,
  compact = false,
}: {
  id: string;
  title: string;
  count: number;
  value: number;
  children?: ReactNode;
  tone?: "success" | "danger";
  /** The closed lanes are drop targets only — no list, no totals. */
  compact?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-card border transition-colors",
        compact ? "border-dashed" : "border-line bg-cream/40",
        tone === "success" && "border-brand/30 bg-brand-tint/40",
        tone === "danger" && "border-danger/25 bg-danger-tint/40",
        !tone && compact && "border-line",
        isOver && "border-brand bg-brand-tint/70",
      )}
    >
      <div
        className={cn(
          "flex items-baseline justify-between gap-2 px-3.5",
          compact ? "py-4" : "border-b border-line/70 py-3",
        )}
      >
        <div className="min-w-0">
          <p
            className={cn(
              "truncate text-[13px] font-medium",
              tone === "success" ? "text-brand" : tone === "danger" ? "text-danger" : "text-ink",
            )}
          >
            {title}
          </p>
          {compact ? (
            <p className="mt-0.5 text-[12px] text-ink/45">Drop a card here</p>
          ) : (
            <p className="mt-0.5 font-display text-sm font-bold tabular-nums text-ink/70">
              {formatMoney(value, true)}
            </p>
          )}
        </div>

        {!compact && (
          <span className="shrink-0 rounded-pill bg-white px-2 py-0.5 text-[11px] font-medium tabular-nums text-ink/50">
            {count}
          </span>
        )}
      </div>

      {!compact && <div className="min-h-[120px] space-y-2 p-2.5">{children}</div>}
    </div>
  );
}
