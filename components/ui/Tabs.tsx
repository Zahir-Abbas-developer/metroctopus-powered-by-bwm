"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  key: T;
  label: string;
  /** Small count chip after the label. */
  count?: number;
}

/**
 * Underlined tab bar. Uses a hairline rule and a 2px active underline rather
 * than pill buttons — closer to editorial section navigation than app chrome.
 */
export function Tabs<T extends string>({
  items,
  active,
  onChange,
  className,
  right,
}: {
  items: readonly TabItem<T>[];
  active: T;
  onChange: (key: T) => void;
  className?: string;
  right?: ReactNode;
}) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3 border-b border-line", className)}>
      <div role="tablist" className="-mb-px flex gap-1 overflow-x-auto">
        {items.map((item) => {
          const selected = item.key === active;

          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(item.key)}
              className={cn(
                "flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-3 text-sm transition-colors",
                selected
                  ? "border-brand font-medium text-ink"
                  : "border-transparent text-ink/50 hover:border-line hover:text-ink/80",
              )}
            >
              {item.label}
              {item.count !== undefined && (
                <span
                  className={cn(
                    "rounded-pill px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
                    selected ? "bg-brand-tint text-brand" : "bg-cream text-ink/50",
                  )}
                >
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {right && <div className="pb-2">{right}</div>}
    </div>
  );
}
