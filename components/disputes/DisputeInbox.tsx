"use client";

import { useCallback, useEffect, useState } from "react";
import { Gavel, Scale, ThumbsDown, ThumbsUp } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/date";
import { SCORE_EVENT_LABEL, formatPoints, type ScoreEventType } from "@/lib/scoring";
import { cn } from "@/lib/utils";

type DisputeRow = {
  id: string;
  status: string;
  reason: string;
  responseNote: string | null;
  resolvedBy: string | null;
  resolvedAsLead: boolean;
  resolvedAt: string | null;
  createdAt: string;
  waitingHours: number | null;
  member: { id: string; name: string; avatarColor: string; jobTitle: string };
  files: { id: string; filename: string; size: number }[];
  event: {
    id: string;
    type: string;
    points: number;
    reason: string;
    at: string;
    milestoneTitle: string | null;
  };
  canResolve: boolean;
};

type Payload = {
  slaHours: number;
  windowDays: number;
  stats: {
    filed: number;
    reversed: number;
    upheld: number;
    open: number;
    reversalRate: number | null;
    insight: string;
  } | null;
  disputes: DisputeRow[];
};

const STATUS_TONE: Record<string, "warning" | "success" | "danger"> = {
  OPEN: "warning",
  REVERSED: "success",
  UPHELD: "danger",
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: "Awaiting a decision",
  REVERSED: "Upheld — points returned",
  UPHELD: "Not upheld",
};

/**
 * Where arguments about points happen now.
 *
 * The insight line under the stats is the important part of this screen for
 * the owner: a rising reversal rate is a measurement of the *rules*, not of
 * the people filing, and a bare percentage invites exactly the opposite
 * reading. So the number never appears without the sentence.
 */
export function DisputeInbox({ isAdmin }: { isAdmin: boolean }) {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [ruling, setRuling] = useState<{ row: DisputeRow; uphold: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/disputes", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rule() {
    if (!ruling) return;
    setBusy(true);

    try {
      const response = await fetch(`/api/disputes/${ruling.row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: ruling.uphold ? "UPHELD" : "REVERSED",
          responseNote: note.trim(),
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success(
        ruling.uphold ? "Charge stands. The member has the reasoning." : "Points returned.",
      );
      setRuling(null);
      setNote("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Skeleton className="h-[420px] rounded-card" />;

  if (state === "error" || !data) {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load disputes"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const open = data.disputes.filter((row) => row.status === "OPEN");
  const decided = data.disputes.filter((row) => row.status !== "OPEN");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="On the record"
        title="Disputes"
        description={`Challenge a score event within ${data.windowDays} days. Whichever way it goes, the original event stays on the ledger.`}
      />

      {isAdmin && data.stats && (
        <Card>
          <div className="grid gap-4 sm:grid-cols-4">
            <Figure label="Filed this month" value={data.stats.filed} />
            <Figure label="Open" value={data.stats.open} tone={data.stats.open > 0 ? "warn" : undefined} />
            <Figure label="Reversed" value={data.stats.reversed} />
            <Figure
              label="Reversal rate"
              value={data.stats.reversalRate === null ? "—" : `${data.stats.reversalRate}%`}
            />
          </div>

          {/* The number never appears without the sentence. */}
          <p className="mt-4 border-t border-line pt-4 text-[13px] leading-relaxed text-ink/60">
            {data.stats.insight}
          </p>
        </Card>
      )}

      <Card padded={false}>
        <CardHeader
          title={isAdmin ? "Awaiting a decision" : "Your open disputes"}
          description={`The SLA is ${data.slaHours} hours.`}
          action={open.length > 0 ? <Badge tone="warning">{open.length}</Badge> : undefined}
        />

        {open.length === 0 ? (
          <EmptyState
            icon={Scale}
            eyebrow="Nothing waiting"
            title="No open disputes"
            description="A member can challenge any deduction from their performance page, and it lands here."
          />
        ) : (
          <ul className="divide-y divide-line">
            {open.map((row) => (
              <li key={row.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <Avatar name={row.member.name} color={row.member.avatarColor} size="md" />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {row.member.name}
                      <span
                        className={cn(
                          "rounded-pill border px-2 py-0.5 text-[11px] font-medium tabular-nums",
                          "border-danger/25 bg-danger-tint text-danger",
                        )}
                      >
                        {formatPoints(row.event.points)}{" "}
                        {SCORE_EVENT_LABEL[row.event.type as ScoreEventType] ?? row.event.type}
                      </span>
                      {row.waitingHours !== null && row.waitingHours >= data.slaHours && (
                        <Badge size="sm" tone="danger">
                          {row.waitingHours}h — past SLA
                        </Badge>
                      )}
                    </p>

                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink/70">{row.reason}</p>

                    <p className="mt-2 rounded-[10px] border border-line bg-cream/50 px-3 py-2 text-[12px] leading-relaxed text-ink/55">
                      The charge: {row.event.reason}
                      <span className="ml-1 text-ink/35">· {formatDateTime(row.event.at)}</span>
                    </p>
                  </div>

                  {row.canResolve && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon={<ThumbsUp className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setRuling({ row, uphold: false });
                          setNote("");
                        }}
                      >
                        Reverse
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<ThumbsDown className="h-3.5 w-3.5" />}
                        onClick={() => {
                          setRuling({ row, uphold: true });
                          setNote("");
                        }}
                      >
                        Uphold
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {decided.length > 0 && (
        <Card padded={false}>
          <CardHeader title="Decided" description="Every ruling, with the reasoning given" />
          <ul className="divide-y divide-line">
            {decided.map((row) => (
              <li key={row.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start gap-3">
                  <Avatar name={row.member.name} color={row.member.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {row.member.name}
                      <span className="ml-2 font-normal text-ink/45">
                        {formatPoints(row.event.points)}{" "}
                        {SCORE_EVENT_LABEL[row.event.type as ScoreEventType] ?? row.event.type}
                      </span>
                    </p>
                    {row.responseNote && (
                      <p className="mt-0.5 text-[13px] leading-relaxed text-ink/60">
                        {row.responseNote}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-ink/35">
                      {row.resolvedBy ? `Decided by ${row.resolvedBy}` : "Decided"}
                      {row.resolvedAsLead && " · as Service Lead"}
                      {row.resolvedAt && ` · ${formatDateTime(row.resolvedAt)}`}
                    </p>
                  </div>
                  <Badge size="sm" tone={STATUS_TONE[row.status] ?? "neutral"}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal
        open={ruling !== null}
        onClose={() => setRuling(null)}
        title={ruling?.uphold ? "Uphold the charge" : "Reverse the charge"}
      >
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-card border border-line bg-cream/50 px-4 py-3">
            <Gavel className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
            <p className="text-[13px] leading-relaxed text-ink/60">
              {ruling?.uphold
                ? "The charge stands and nothing changes on the ledger. The member gets your reasoning."
                : `A compensating adjustment of ${
                    ruling ? Math.abs(ruling.row.event.points) : 0
                  } points is written beside the original. The original stays — the audit trail never lies.`}
            </p>
          </div>

          <Textarea
            label={ruling?.uphold ? "Why the charge stands" : "Why you're reversing it"}
            requiredMark
            rows={4}
            autoFocus
            value={note}
            placeholder={
              ruling?.uphold
                ? "The deadline was agreed in Monday's call and the brief hadn't changed."
                : "You're right — the client's asset arrived on the 14th, not the 11th. My mistake."
            }
            onChange={(event) => setNote(event.target.value)}
            hint="Sent to the member. A decision with no reasoning is what this replaces."
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRuling(null)}>
              Cancel
            </Button>
            <Button
              variant={ruling?.uphold ? "danger" : "primary"}
              loading={busy}
              disabled={note.trim().length < 10}
              onClick={() => void rule()}
            >
              {ruling?.uphold ? "Uphold" : "Reverse and return the points"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "warn";
}) {
  return (
    <div>
      <p className="eyebrow text-ink/45">{label}</p>
      <p
        className={cn(
          "mt-2 font-display text-2xl font-extrabold tabular-nums",
          tone === "warn" ? "text-warn" : "text-ink",
        )}
      >
        {value}
      </p>
    </div>
  );
}
