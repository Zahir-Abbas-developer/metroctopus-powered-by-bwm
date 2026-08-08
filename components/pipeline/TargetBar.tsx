"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Crosshair } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { BUCKET_DESCRIPTION, BUCKET_LABEL, type ActivityBucket } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";

type Row = {
  member: { id: string; name: string; jobTitle: string; avatarColor: string };
  targets: { bucket: string; weeklyTarget: number }[];
  outcome: {
    progress: {
      bucket: ActivityBucket;
      target: number;
      logged: number;
      percent: number;
      met: boolean;
      missed: boolean;
    }[];
    metCount: number;
    missedCount: number;
    points: number;
  };
};

/**
 * This week's activity targets, filling live.
 *
 * On the member's own dashboard, not buried in a report — a target you check
 * on Sunday night is a scoreboard, and a target you can see filling on
 * Wednesday is a plan. Rendered from the same `evaluateWeek` the Sunday job
 * uses, so the bar and the points cannot disagree.
 */
export function TargetBar({ userId }: { userId: string }) {
  const [row, setRow] = useState<Row | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "empty">("loading");

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/targets?userId=${userId}`, { cache: "no-store" });
      if (!response.ok) {
        setState("empty");
        return;
      }
      const body = (await response.json()) as { rows: Row[] };
      const own = body.rows[0];
      if (!own || own.outcome.progress.length === 0) {
        setState("empty");
        return;
      }
      setRow(own);
      setState("ready");
    } catch {
      setState("empty");
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") return <Skeleton className="h-[148px] rounded-card" />;
  // No targets set is not an error and not an empty state — it is simply not
  // this person's job, so the card doesn't appear at all.
  if (state === "empty" || !row) return null;

  const { outcome } = row;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Crosshair className="h-4 w-4 text-ink/40" />
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              This week&rsquo;s targets
            </h2>
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
            Settled on Monday morning. Each target met is a point; only a week
            under 60% costs one.
          </p>
        </div>

        <div className="text-right">
          <p
            className={cn(
              "font-display text-2xl font-extrabold tabular-nums leading-none",
              outcome.points > 0 ? "text-brand" : outcome.points < 0 ? "text-danger" : "text-ink",
            )}
          >
            {outcome.points > 0 ? "+" : ""}
            {outcome.points}
          </p>
          <p className="mt-1 text-[12px] text-ink/45">if the week ended now</p>
        </div>
      </div>

      <div className="mt-5 space-y-3.5">
        {outcome.progress.map((progress) => (
          <div key={progress.bucket}>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span
                className="text-[13px] font-medium text-ink"
                title={BUCKET_DESCRIPTION[progress.bucket]}
              >
                {BUCKET_LABEL[progress.bucket]}
              </span>
              <span
                className={cn(
                  "text-[13px] tabular-nums",
                  progress.met
                    ? "text-brand"
                    : progress.missed
                      ? "text-danger"
                      : "text-ink/55",
                )}
              >
                {progress.logged}
                <span className="text-ink/35"> / {progress.target}</span>
              </span>
            </div>

            <div className="h-2 overflow-hidden rounded-pill bg-cream">
              <div
                className={cn(
                  "h-full rounded-pill transition-[width] duration-500",
                  progress.met ? "bg-brand" : progress.missed ? "bg-danger" : "bg-warn",
                )}
                style={{ width: `${Math.max(progress.percent, progress.logged > 0 ? 4 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <Link
        href="/pipeline"
        className="mt-4 inline-block text-[13px] text-ink/50 transition-colors hover:text-brand"
      >
        Open the pipeline →
      </Link>
    </Card>
  );
}
