"use client";

import { useCallback, useEffect, useState } from "react";
import { PlugZap, Wifi } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { OUTAGE_TYPES, OUTAGE_TYPE_LABEL, type OutageType } from "@/lib/fairness-windows";
import { formatKarachiTime } from "@/lib/attendance-time";
import { cn } from "@/lib/utils";

type OutageRow = {
  id: string;
  type: string;
  startsAt: string;
  endsAt: string;
  note: string;
  status: string;
  filedLate: boolean;
  adminNote: string | null;
  reviewedBy: string | null;
  checksCovered: number;
  createdAt: string;
};

type Payload = {
  quota: { used: number; allowance: number; remaining: number; maxHours: number };
  reports: OutageRow[];
};

const STATUS_TONE: Record<string, "warning" | "success" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Waiting on the owner",
  APPROVED: "Excused",
  REJECTED: "Not upheld",
};

/**
 * Declaring time the member genuinely could not be reached.
 *
 * Filing after the fact is allowed on purpose — an outage stops you filing a
 * report about it — so the form defaults to a window that has already
 * happened rather than making the member fight the input.
 */
export function OutagePanel({ onChange }: { onChange?: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [type, setType] = useState<OutageType>("POWER");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/outages", { cache: "no-store" });
      if (!response.ok) return;
      setData((await response.json()) as Payload);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openForm() {
    // Defaults to the last hour, which is the overwhelmingly common case.
    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    setStartsAt(toLocalInput(hourAgo));
    setEndsAt(toLocalInput(now));
    setNote("");
    setErrors({});
    setOpen(true);
  }

  async function submit() {
    setBusy(true);
    setErrors({});

    try {
      const response = await fetch("/api/outages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          note,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't file that report.");
        return;
      }

      toast.success(
        body.checksCovered > 0
          ? `Filed. ${body.checksCovered} check${body.checksCovered === 1 ? "" : "s"} on hold pending the owner's decision.`
          : "Filed. No checks fell in that window.",
      );
      setOpen(false);
      await load();
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-[168px] rounded-card" />;
  if (!data) return null;

  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <PlugZap className="h-4 w-4 text-ink/40" />
              <h2 className="font-display text-base font-bold tracking-tight text-ink">
                Outages
              </h2>
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
              Power cut or internet down? Report it and any check in that window
              waits for the owner instead of costing you a point.
            </p>
          </div>

          <Button size="sm" variant="secondary" onClick={openForm}>
            Report outage
          </Button>
        </div>

        <p className="mt-3 text-[12px] text-ink/45">
          {data.quota.remaining} of {data.quota.allowance} reports left this month ·
          up to {data.quota.maxHours}h each
        </p>

        {data.reports.length > 0 && (
          <ul className="mt-4 space-y-2 border-t border-line pt-4">
            {data.reports.slice(0, 4).map((report) => (
              <li key={report.id} className="flex items-start gap-3">
                {report.type === "POWER" ? (
                  <PlugZap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/30" />
                ) : (
                  <Wifi className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/30" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-ink">
                    {formatKarachiTime(new Date(report.startsAt))} –{" "}
                    {formatKarachiTime(new Date(report.endsAt))}
                    <span className="ml-2 text-[12px] text-ink/40">
                      {report.checksCovered} check
                      {report.checksCovered === 1 ? "" : "s"}
                    </span>
                  </p>
                  {report.adminNote && (
                    <p className="mt-0.5 text-[12px] text-ink/50">{report.adminNote}</p>
                  )}
                </div>
                <Badge size="sm" tone={STATUS_TONE[report.status] ?? "neutral"}>
                  {STATUS_LABEL[report.status] ?? report.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title="Report an outage">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink/80">What happened</p>
            <div className="flex gap-1.5">
              {OUTAGE_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setType(option)}
                  className={cn(
                    "rounded-pill border px-3.5 py-1.5 text-[13px] transition-colors",
                    type === option
                      ? "border-brand bg-brand text-paper"
                      : "border-line bg-white text-ink/55 hover:border-ink/25",
                  )}
                >
                  {OUTAGE_TYPE_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="From"
              type="datetime-local"
              value={startsAt}
              error={errors.startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
            />
            <Input
              label="To"
              type="datetime-local"
              value={endsAt}
              error={errors.endsAt}
              onChange={(event) => setEndsAt(event.target.value)}
            />
          </div>

          <Textarea
            label="What happened"
            rows={3}
            value={note}
            error={errors.note}
            placeholder="Load-shedding block, no backup power until 5pm."
            onChange={(event) => setNote(event.target.value)}
          />

          <p className="text-[12px] leading-relaxed text-ink/45">
            Filing after a check has already expired is fine — an outage stops
            you filing too. It&rsquo;s flagged for the owner, not held against you.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void submit()}>
              File report
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** `datetime-local` wants the browser's own wall clock, not an ISO string. */
function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
