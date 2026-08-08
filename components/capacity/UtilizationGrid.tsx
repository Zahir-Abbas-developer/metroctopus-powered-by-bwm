"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Users2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { LOAD_BAND_LABEL, type LoadBand } from "@/lib/capacity";
import { cn } from "@/lib/utils";

type Grid = {
  from: string;
  weeks: number;
  grid: {
    userId: string;
    name: string;
    jobTitle: string;
    avatarColor: string;
    capacityHours: number;
    weeks: {
      week: string;
      hours: number;
      capacityHours: number;
      percent: number;
      band: LoadBand;
      milestones: number;
    }[];
  }[];
};

/**
 * Members × weeks, as a heat grid.
 *
 * Deliberately a grid rather than a per-person chart: the failure this is
 * meant to make obvious is *imbalance* — one person scarlet across four weeks
 * while somebody beside them is empty — and that pattern only shows up when
 * everybody is on the same axis.
 */
const CELL: Record<LoadBand, string> = {
  LIGHT: "bg-cream text-ink/40",
  HEALTHY: "bg-brand-tint text-brand",
  TIGHT: "bg-warn-tint text-warn",
  OVER: "bg-danger-tint text-danger",
};

export function UtilizationGrid() {
  const [offsetWeeks, setOffsetWeeks] = useState(0);
  const [data, setData] = useState<Grid | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const from = new Date(Date.now() + offsetWeeks * 7 * 86_400_000).toISOString();
      const response = await fetch(`/api/capacity?weeks=8&from=${from}`, {
        cache: "no-store",
      });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Grid);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [offsetWeeks]);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === "loading") return <Skeleton className="h-[360px] rounded-card" />;

  if (state === "error" || !data) {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load utilization"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const weeks = data.grid[0]?.weeks ?? [];

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            Utilization
          </h2>
          <p className="mt-0.5 text-[13px] text-ink/50">
            Estimated hours against weekly capacity. Live work only — completed
            milestones don&rsquo;t occupy a week.
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Earlier weeks"
            icon={<ChevronLeft className="h-4 w-4" />}
            onClick={() => setOffsetWeeks((current) => current - 4)}
          />
          {offsetWeeks !== 0 && (
            <Button size="sm" variant="ghost" onClick={() => setOffsetWeeks(0)}>
              Today
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            aria-label="Later weeks"
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => setOffsetWeeks((current) => current + 4)}
          />
        </div>
      </div>

      {data.grid.length === 0 ? (
        <EmptyState
          icon={Users2}
          title="No team members"
          description="Add people from the team page and their weeks fill in here."
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="bg-cream">
                <tr>
                  <th
                    scope="col"
                    className="eyebrow sticky left-0 z-10 border-b border-line bg-cream px-4 py-3 text-left text-ink/50"
                  >
                    Member
                  </th>
                  {weeks.map((week) => (
                    <th
                      key={week.week}
                      scope="col"
                      className="border-b border-line px-1 py-3 text-center text-[10px] font-semibold tabular-nums text-ink/40"
                    >
                      W{Number(week.week.split("-W")[1])}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody className="divide-y divide-line">
                {data.grid.map((member) => (
                  <tr key={member.userId}>
                    <th
                      scope="row"
                      className="sticky left-0 z-10 whitespace-nowrap border-r border-line bg-white px-4 py-2.5 text-left"
                    >
                      <span className="flex items-center gap-2.5">
                        <Avatar
                          name={member.name}
                          color={member.avatarColor}
                          size="sm"
                          className="h-6 w-6 text-[9px]"
                        />
                        <span className="block">
                          <span className="block text-[13px] font-medium text-ink">
                            {member.name}
                          </span>
                          <span className="block text-[11px] text-ink/40">
                            {member.capacityHours}h/week
                          </span>
                        </span>
                      </span>
                    </th>

                    {member.weeks.map((week) => (
                      <td key={week.week} className="p-1 text-center">
                        <span
                          title={`${week.hours}h across ${week.milestones} milestone${
                            week.milestones === 1 ? "" : "s"
                          } — ${LOAD_BAND_LABEL[week.band]}`}
                          className={cn(
                            "flex h-9 flex-col items-center justify-center rounded-[6px] text-[11px] font-semibold tabular-nums",
                            week.milestones === 0 ? "bg-white text-ink/15" : CELL[week.band],
                          )}
                        >
                          {week.milestones === 0 ? "–" : `${week.percent}%`}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-3 text-[12px] text-ink/45">
            {(["LIGHT", "HEALTHY", "TIGHT", "OVER"] as LoadBand[]).map((band) => (
              <span key={band} className="inline-flex items-center gap-1.5">
                <span className={cn("h-3 w-3 rounded-[3px]", CELL[band].split(" ")[0])} />
                {LOAD_BAND_LABEL[band]}
              </span>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
