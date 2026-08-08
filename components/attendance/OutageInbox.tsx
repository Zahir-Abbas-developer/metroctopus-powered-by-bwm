"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, PlugZap, Wifi, X } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/date";

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
  member: { id: string; name: string; avatarColor: string; jobTitle: string };
};

/**
 * The owner's decision on declared outages.
 *
 * Approving costs nothing and excuses the checks; rejecting reinstates the
 * penalty, so it demands a written reason. The "filed late" flag is shown as a
 * fact rather than styled as a warning — an outage stops you filing a report
 * about it, so lateness is expected and only occasionally suspicious.
 */
export function OutageInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<OutageRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<OutageRow | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/outages", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const body = (await response.json()) as { reports: OutageRow[] };
      setRows(body.reports);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(row: OutageRow, status: "APPROVED" | "REJECTED", adminNote?: string) {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/outages/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, ...(adminNote ? { adminNote } : {}) }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success(
        status === "APPROVED"
          ? `Excused ${body.excused ?? 0} check${body.excused === 1 ? "" : "s"}.${
              body.reversed > 0 ? ` ${body.reversed} penalty reversed.` : ""
            }`
          : "Not upheld — the penalty stands.",
      );
      setRejecting(null);
      setNote("");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (state === "loading") return <Skeleton className="h-[280px] rounded-card" />;

  if (state === "error") {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load outage reports"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const pending = rows.filter((row) => row.status === "PENDING");
  const decided = rows.filter((row) => row.status !== "PENDING");

  return (
    <>
      <div className="space-y-5">
        <Card padded={false}>
          <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <h2 className="font-display text-base font-bold tracking-tight text-ink">
                Outage reports
              </h2>
              <p className="mt-0.5 text-[13px] text-ink/50">
                Checks on hold. Nothing is charged until you decide.
              </p>
            </div>
            {pending.length > 0 && <Badge tone="warning">{pending.length}</Badge>}
          </div>

          {pending.length === 0 ? (
            <EmptyState
              icon={PlugZap}
              eyebrow="Nothing waiting"
              title="No outages to review"
              description="A member reporting a power cut or dropped connection appears here."
            />
          ) : (
            <ul className="divide-y divide-line">
              {pending.map((row) => (
                <li key={row.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                  <Avatar name={row.member.name} color={row.member.avatarColor} size="md" />

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                      {row.member.name}
                      <span className="inline-flex items-center gap-1 text-[12px] font-normal text-ink/45">
                        {row.type === "POWER" ? (
                          <PlugZap className="h-3 w-3" />
                        ) : (
                          <Wifi className="h-3 w-3" />
                        )}
                        {formatDateTime(row.startsAt)} – {formatDateTime(row.endsAt)}
                      </span>
                      {row.filedLate && (
                        <Badge size="sm" tone="neutral">
                          Filed after the check expired
                        </Badge>
                      )}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-ink/60">{row.note}</p>
                    <p className="mt-1 text-[12px] text-ink/40">
                      Covers {row.checksCovered} check{row.checksCovered === 1 ? "" : "s"}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      disabled={busyId === row.id}
                      icon={<Check className="h-3.5 w-3.5" />}
                      onClick={() => void review(row, "APPROVED")}
                    >
                      Excuse
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busyId === row.id}
                      icon={<X className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setRejecting(row);
                        setNote("");
                      }}
                    >
                      Reject
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {decided.length > 0 && (
          <Card padded={false}>
            <div className="border-b border-line px-5 py-4">
              <h2 className="font-display text-base font-bold tracking-tight text-ink">
                Decided
              </h2>
            </div>
            <ul className="divide-y divide-line">
              {decided.slice(0, 20).map((row) => (
                <li key={row.id} className="flex items-center gap-4 px-5 py-3.5">
                  <Avatar name={row.member.name} color={row.member.avatarColor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {row.member.name} · {formatDateTime(row.startsAt)}
                    </p>
                    <p className="truncate text-[12px] text-ink/45">
                      {row.adminNote ?? row.note}
                      {row.reviewedBy && ` · decided by ${row.reviewedBy}`}
                    </p>
                  </div>
                  <Badge size="sm" tone={row.status === "APPROVED" ? "success" : "danger"}>
                    {row.status === "APPROVED" ? "Excused" : "Not upheld"}
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Reject this outage report"
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink/60">
            The held checks become missed and the penalty applies. The reason is
            sent to {rejecting?.member.name ?? "the member"}.
          </p>

          <Textarea
            label="Why it isn't upheld"
            rows={3}
            value={note}
            autoFocus
            placeholder="You were active in the board at 4:20pm, inside the window you've reported as down."
            onChange={(event) => setNote(event.target.value)}
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={note.trim().length < 5}
              loading={busyId === rejecting?.id}
              onClick={() => rejecting && void review(rejecting, "REJECTED", note.trim())}
            >
              Reject
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
