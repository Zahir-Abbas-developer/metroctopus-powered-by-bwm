"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCheck, Inbox, ThumbsDown } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { ApproveDialog } from "@/components/quality/ApproveDialog";
import { REVIEW_AGE_TONE, type ReviewAge } from "@/lib/fairness-types";
import { cn } from "@/lib/utils";

type QueueRow = {
  id: string;
  title: string;
  weight: number;
  submittedAt: string;
  waitingHours: number;
  age: ReviewAge;
  assignee: { id: string; name: string; avatarColor: string } | null;
  clientName: string;
  moduleName: string;
  lead: { id: string; name: string } | null;
  escalated: boolean;
};

type Payload = {
  viewer: { id: string; isAdmin: boolean };
  reviewers: { userId: string; name: string; decided: number; averageMinutes: number }[];
  stats: {
    averageMinutes: number | null;
    decided: number;
    queued: number;
    stale: number;
    longestWaitHours: number | null;
  };
  queue: QueueRow[];
};

/**
 * The owner's queue.
 *
 * Phase 8 took review time out of members' scores; this is the other half of
 * that trade. Every row carries how long someone has been waiting, and the
 * colour is not decorative — red means a member has been sitting on a
 * finished piece of work for two days with no answer.
 *
 * Approve and reject are here rather than only in the drawer because a queue
 * you have to leave in order to clear is a queue that doesn't get cleared.
 */
export function ReviewQueue() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "none">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [approving, setApproving] = useState<QueueRow | null>(null);
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/review-queue", { cache: "no-store" });
      // 403 means this person has no queue — not an error, just nothing to show.
      if (response.status === 403) {
        setData(null);
        setState("none");
        return;
      }
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

  async function decide(
    row: QueueRow,
    to: "COMPLETED" | "IN_PROGRESS",
    extra: { reason?: string; qualityRating?: number; qualityComment?: string } = {},
  ) {
    setBusyId(row.id);
    try {
      const response = await fetch(`/api/milestones/${row.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: to, ...extra }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success(to === "COMPLETED" ? "Approved." : "Sent back for rework.");
      setRejecting(null);
      setApproving(null);
      setReason("");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (state === "loading") return <Skeleton className="h-[320px] rounded-card" />;
  // A member who leads nothing has no queue. Render nothing rather than an
  // empty state explaining a feature they don't have.
  if (state === "none") return null;

  if (state === "error" || !data) {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load the review queue"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const { queue, stats } = data;

  return (
    <>
      <Card padded={false}>
        <CardHeader
          title="Awaiting your review"
          description={
            stats.averageMinutes === null
              ? "Submitted work, longest wait first"
              : `Submitted work, longest wait first · you average ${formatWait(stats.averageMinutes)}`
          }
          action={
            queue.length > 0 ? (
              <Badge tone={stats.stale > 0 ? "danger" : "warning"}>{queue.length}</Badge>
            ) : undefined
          }
        />

        {queue.length === 0 ? (
          <EmptyState
            icon={Inbox}
            eyebrow="Nothing waiting"
            title="The queue is clear"
            description="Work appears here the moment a member submits it, and members are never charged for the time it spends waiting."
          />
        ) : (
          <ul className="divide-y divide-line">
            {queue.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
                {row.assignee ? (
                  <Avatar
                    name={row.assignee.name}
                    color={row.assignee.avatarColor}
                    size="sm"
                  />
                ) : (
                  <span className="h-8 w-8 rounded-full border border-dashed border-line" />
                )}

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{row.title}</p>
                  <p className="truncate text-[12px] text-ink/45">
                    {row.clientName} · {row.moduleName}
                    {row.assignee ? ` · ${row.assignee.name}` : ""}
                  </p>
                </div>

                {/* Where it's routed. An escalated row is one the lead has
                    already had a full day with. */}
                {row.lead && (
                  <Badge size="sm" tone={row.escalated ? "warning" : "neutral"}>
                    {row.escalated ? `${row.lead.name} · escalated` : row.lead.name}
                  </Badge>
                )}
                {!row.lead && data.viewer.isAdmin && (
                  <Badge size="sm" tone="neutral">
                    Owner only
                  </Badge>
                )}

                <Badge size="sm" tone={REVIEW_AGE_TONE[row.age]}>
                  {formatHours(row.waitingHours)}
                </Badge>

                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    disabled={busyId === row.id}
                    icon={<CheckCheck className="h-3.5 w-3.5" />}
                    onClick={() => setApproving(row)}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busyId === row.id}
                    icon={<ThumbsDown className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setRejecting(row);
                      setReason("");
                    }}
                    className="hover:text-danger"
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {data.viewer.isAdmin && data.reviewers.length > 1 && (
          <div className="border-t border-line px-5 py-3">
            <p className="eyebrow mb-2 text-ink/45">Average decision time</p>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-ink/55">
              {data.reviewers.map((reviewer) => (
                <li key={reviewer.userId} className="tabular-nums">
                  {reviewer.name}{" "}
                  <span className="font-medium text-ink/75">
                    {formatWait(reviewer.averageMinutes)}
                  </span>{" "}
                  <span className="text-ink/35">over {reviewer.decided}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {stats.stale > 0 && (
          <p className="border-t border-line px-5 py-3 text-[12px] leading-relaxed text-danger">
            {stats.stale} {stats.stale === 1 ? "item has" : "items have"} been waiting
            over 48 hours. Review time is the reviewer&rsquo;s metric now — it no
            longer costs the member anything, but they are still blocked on the
            answer.
          </p>
        )}
      </Card>

      <ApproveDialog
        open={approving !== null}
        title={approving?.title ?? ""}
        memberName={approving?.assignee?.name ?? null}
        busy={busyId === approving?.id}
        onClose={() => setApproving(null)}
        onApprove={async (qualityRating, qualityComment) => {
          if (approving) await decide(approving, "COMPLETED", { qualityRating, qualityComment });
        }}
      />

      <Modal
        open={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Send back for rework"
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink/60">
            {rejecting?.assignee?.name ?? "The member"} is charged{" "}
            {(rejecting?.weight ?? 0) * 0.5} points for a rejection, so the reason
            has to be specific enough to act on.
          </p>

          <Textarea
            label="What needs reworking"
            rows={4}
            value={reason}
            autoFocus
            placeholder="The ROAS figure doesn't reconcile with the ad account — check the date range."
            onChange={(event) => setReason(event.target.value)}
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejecting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 5}
              loading={busyId === rejecting?.id}
              onClick={() =>
                rejecting && void decide(rejecting, "IN_PROGRESS", { reason: reason.trim() })
              }
            >
              Send back
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

/** "3h" / "2d 4h" — an age badge has to read at a glance. */
function formatHours(hours: number): string {
  if (hours < 1) return "just now";
  if (hours < 24) return `${Math.round(hours)}h`;
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours % 24);
  return rest === 0 ? `${days}d` : `${days}d ${rest}h`;
}

function formatWait(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round((hours / 24) * 10) / 10}d`;
}
