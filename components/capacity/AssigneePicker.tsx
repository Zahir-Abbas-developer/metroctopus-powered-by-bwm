"use client";

import { useCallback, useEffect, useState } from "react";
import { Lightbulb, TriangleAlert } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { LOAD_BAND_TONE, loadBand } from "@/lib/capacity";
import { cn } from "@/lib/utils";

type Candidate = {
  userId: string;
  name: string;
  jobTitle: string;
  avatarColor: string;
  percent: number;
  hours: number;
  capacityHours: number;
  qualified: boolean;
};

type Payload = {
  week: string;
  estimatedHours: number;
  candidates: Candidate[];
  suggestion: {
    candidate: Candidate;
    projectedPercent: number;
    reason: string;
  } | null;
};

const BAR_CLASS: Record<string, string> = {
  neutral: "bg-ink/25",
  success: "bg-brand",
  warning: "bg-warn",
  danger: "bg-danger",
};

/**
 * Choosing who does the work, with everyone's week visible.
 *
 * The whole point of Phase 9's capacity work is that overload is prevented at
 * the moment of assignment rather than diagnosed afterwards from the misses it
 * caused — so the load bars are *here*, in the picker, not on a separate page
 * somebody would have to think to open.
 */
export function AssigneePicker({
  dueDate,
  estimatedHours,
  serviceSlug,
  excludeMilestoneId,
  value,
  onChange,
  label = "Assignee",
}: {
  dueDate: string;
  estimatedHours: number;
  serviceSlug?: string | null;
  excludeMilestoneId?: string | null;
  value: string | null;
  onChange: (userId: string | null) => void;
  label?: string;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState<Candidate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        dueDate,
        estimatedHours: String(estimatedHours),
      });
      if (serviceSlug) params.set("serviceSlug", serviceSlug);
      if (excludeMilestoneId) params.set("excludeMilestoneId", excludeMilestoneId);

      const response = await fetch(`/api/capacity?${params}`, { cache: "no-store" });
      if (!response.ok) return;
      setData((await response.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, [dueDate, estimatedHours, serviceSlug, excludeMilestoneId]);

  useEffect(() => {
    void load();
  }, [load]);

  function pick(candidate: Candidate) {
    if (candidate.userId === value) {
      onChange(null);
      return;
    }

    const projected =
      candidate.capacityHours <= 0
        ? 100
        : Math.round(((candidate.hours + estimatedHours) / candidate.capacityHours) * 100);

    // Past 100% we stop and ask. Not at the amber band — a warning that fires
    // whenever someone is merely busy gets clicked through without reading,
    // and then the one that matters gets clicked through too.
    if (projected > 100) {
      setConfirming(candidate);
      return;
    }

    onChange(candidate.userId);
  }

  if (loading && !data) return <Skeleton className="h-[180px] rounded-card" />;
  if (!data) return null;

  return (
    <>
      <div>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <p className="text-[13px] font-medium text-ink/80">{label}</p>
          <p className="text-[12px] text-ink/45">
            Load in {formatWeek(data.week)} · {estimatedHours}h of work
          </p>
        </div>

        <div className="space-y-1.5">
          {data.candidates.map((candidate) => {
            const selected = candidate.userId === value;
            const projected =
              candidate.capacityHours <= 0
                ? 100
                : Math.round(
                    ((candidate.hours + (selected ? estimatedHours : 0)) /
                      candidate.capacityHours) *
                      100,
                  );
            const band = loadBand(projected);

            return (
              <button
                key={candidate.userId}
                type="button"
                onClick={() => pick(candidate)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-[10px] border p-2.5 text-left transition-colors",
                  selected
                    ? "border-brand bg-brand-tint/50"
                    : "border-line bg-white hover:border-ink/25",
                )}
              >
                <Avatar name={candidate.name} color={candidate.avatarColor} size="sm" />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                    {candidate.name}
                    {candidate.qualified && (
                      <span className="rounded-pill bg-cream px-1.5 py-0.5 text-[10px] font-normal text-ink/50">
                        fits
                      </span>
                    )}
                  </p>

                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-pill bg-cream">
                    <div
                      className={cn(
                        "h-full rounded-pill transition-[width]",
                        BAR_CLASS[LOAD_BAND_TONE[band]],
                      )}
                      style={{ width: `${Math.min(100, projected)}%` }}
                    />
                  </div>
                </div>

                <span
                  className={cn(
                    "w-12 shrink-0 text-right text-[13px] tabular-nums",
                    band === "OVER"
                      ? "font-medium text-danger"
                      : band === "TIGHT"
                        ? "text-warn"
                        : "text-ink/50",
                  )}
                >
                  {projected}%
                </span>
              </button>
            );
          })}
        </div>

        {data.suggestion && data.suggestion.candidate.userId !== value && (
          <button
            type="button"
            onClick={() => pick(data.suggestion!.candidate)}
            className="mt-2 flex w-full items-start gap-2 rounded-[10px] border border-info/20 bg-info-tint px-3 py-2.5 text-left transition-colors hover:border-info/40"
          >
            <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
            <span className="text-[12px] leading-relaxed text-info">
              Try {data.suggestion.candidate.name.split(" ")[0]} —{" "}
              {data.suggestion.reason.toLowerCase()}
            </span>
          </button>
        )}
      </div>

      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="That's over capacity"
      >
        {confirming && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-card border border-danger/20 bg-danger-tint px-4 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
              <p className="text-[13px] leading-relaxed text-danger">
                {confirming.name.split(" ")[0]} is at{" "}
                {Math.round((confirming.hours / Math.max(1, confirming.capacityHours)) * 100)}% for{" "}
                {formatWeek(data.week)}. Adding {estimatedHours}h takes them to{" "}
                {confirming.capacityHours <= 0
                  ? 100
                  : Math.round(
                      ((confirming.hours + estimatedHours) / confirming.capacityHours) * 100,
                    )}
                %.
              </p>
            </div>

            <p className="text-[13px] leading-relaxed text-ink/60">
              Overloading someone is how a deadline gets missed, and a missed
              deadline costs them points. Assign it anyway if that&rsquo;s the
              call — or pick someone with room.
            </p>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Pick someone else
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  onChange(confirming.userId);
                  setConfirming(null);
                }}
              >
                Assign anyway
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

/** "week 33" reads better in a sentence than "2026-W33". */
function formatWeek(key: string): string {
  const [, week] = key.split("-W");
  return `week ${Number(week)}`;
}
