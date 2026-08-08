"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Grid3x3 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";

type Cell = {
  date: string;
  status: string | null;
  totalMinutes: number | null;
  checksPassed: number;
  checksTotal: number;
};

type Matrix = {
  period: { year: number; month: number };
  dates: string[];
  grid: {
    member: { id: string; name: string; jobTitle: string; avatarColor: string };
    cells: Cell[];
  }[];
};

const CELL_STYLE: Record<string, string> = {
  PRESENT: "bg-brand-tint text-brand",
  LATE: "bg-warn-tint text-warn",
  ABSENT: "bg-danger-tint text-danger",
  LEAVE: "bg-cream text-ink/40",
  OFF: "bg-cream/50 text-ink/25",
};

const CELL_LETTER: Record<string, string> = {
  PRESENT: "P",
  LATE: "L",
  ABSENT: "A",
  LEAVE: "V",
  OFF: "·",
};

/** Members × days, with a CSV export for anyone who wants it in a spreadsheet. */
export function AttendanceMatrix() {
  const now = new Date();
  const [period, setPeriod] = useState({
    year: Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", year: "numeric" }).format(now),
    ),
    month: Number(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Karachi", month: "2-digit" }).format(now),
    ),
  });

  const [data, setData] = useState<Matrix | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch(
        `/api/attendance/matrix?year=${period.year}&month=${period.month}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Matrix);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  function shift(delta: number) {
    setPeriod((current) => {
      const month = current.month + delta;
      if (month < 1) return { year: current.year - 1, month: 12 };
      if (month > 12) return { year: current.year + 1, month: 1 };
      return { ...current, month };
    });
  }

  const monthLabel = new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(period.year, period.month - 1, 1)));

  if (state === "loading") return <Skeleton className="h-[360px] rounded-card" />;

  if (state === "error") {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load the month"
          description="The matrix didn't come back. This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card padded={false}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            {monthLabel}
          </h2>
          <p className="mt-0.5 text-[13px] text-ink/50">
            P present · L late · A absent · V leave · · day off
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Previous month"
            icon={<ChevronLeft className="h-4 w-4" />}
            onClick={() => shift(-1)}
          />
          <Button
            size="sm"
            variant="ghost"
            aria-label="Next month"
            icon={<ChevronRight className="h-4 w-4" />}
            onClick={() => shift(1)}
          />
          <a
            href={`/api/attendance/matrix?year=${period.year}&month=${period.month}&format=csv`}
            className="ml-1 inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-3 py-1.5 text-[13px] text-ink/70 transition-colors hover:border-ink/25 hover:text-ink"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </a>
        </div>
      </div>

      {data.grid.length === 0 ? (
        <EmptyState
          icon={Grid3x3}
          title="No team members"
          description="Add people from the team page and the month fills in."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="bg-cream">
              <tr>
                <th
                  scope="col"
                  className="eyebrow sticky left-0 z-10 border-b border-line bg-cream px-4 py-3 text-left text-ink/50"
                >
                  Member
                </th>
                {data.dates.map((date) => (
                  <th
                    key={date}
                    scope="col"
                    className="border-b border-line px-0 py-3 text-center text-[10px] font-semibold tabular-nums text-ink/40"
                  >
                    {Number(date.slice(-2))}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody className="divide-y divide-line">
              {data.grid.map((row) => (
                <tr key={row.member.id}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-r border-line bg-white px-4 py-2.5 text-left"
                  >
                    <span className="block text-[13px] font-medium text-ink">
                      {row.member.name}
                    </span>
                  </th>

                  {row.cells.map((cell) => (
                    <td key={cell.date} className="p-0.5 text-center">
                      <span
                        title={
                          cell.status
                            ? `${cell.date} · ${cell.status}${
                                cell.checksTotal > 0
                                  ? ` · ${cell.checksPassed}/${cell.checksTotal} checks`
                                  : ""
                              }`
                            : cell.date
                        }
                        className={cn(
                          "flex h-7 items-center justify-center rounded-[5px] text-[11px] font-semibold tabular-nums",
                          cell.status ? CELL_STYLE[cell.status] : "text-ink/15",
                        )}
                      >
                        {cell.status ? CELL_LETTER[cell.status] : "–"}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
