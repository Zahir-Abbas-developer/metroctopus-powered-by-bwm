"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Plane, X } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";

type LeaveRow = {
  id: string;
  date: string;
  reason: string;
  status: string;
  member: { id: string; name: string; avatarColor: string; jobTitle: string };
  reviewedBy: string | null;
  reviewedAt: string | null;
};

/** Approve or decline time off. The decision is recorded against the owner. */
export function LeaveInbox() {
  const toast = useToast();
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/leave", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const body = (await response.json()) as { requests: LeaveRow[] };
      setRows(body.requests);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function review(id: string, status: "APPROVED" | "REJECTED") {
    setBusyId(id);
    try {
      const response = await fetch(`/api/leave/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success(status === "APPROVED" ? "Leave approved." : "Leave declined.");
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
          title="Couldn't load leave requests"
          description="The inbox didn't come back. This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const pending = rows.filter((row) => row.status === "PENDING");
  const decided = rows.filter((row) => row.status !== "PENDING");

  return (
    <div className="space-y-5">
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            Awaiting your decision
          </h2>
          {pending.length > 0 && <Badge tone="warning">{pending.length}</Badge>}
        </div>

        {pending.length === 0 ? (
          <EmptyState
            icon={Plane}
            eyebrow="Nothing waiting"
            title="No leave requests"
            description="Requests appear here the moment someone asks for a day off."
          />
        ) : (
          <ul className="divide-y divide-line">
            {pending.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={row.member.name} color={row.member.avatarColor} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-ink">
                    {row.member.name}
                    <span className="ml-2 text-[12px] font-normal text-ink/45">
                      {row.date}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-ink/60">
                    {row.reason}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    disabled={busyId === row.id}
                    icon={<Check className="h-3.5 w-3.5" />}
                    onClick={() => void review(row.id, "APPROVED")}
                  >
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busyId === row.id}
                    icon={<X className="h-3.5 w-3.5" />}
                    onClick={() => void review(row.id, "REJECTED")}
                  >
                    Decline
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
            {decided.map((row) => (
              <li key={row.id} className="flex items-center gap-4 px-5 py-3.5">
                <Avatar name={row.member.name} color={row.member.avatarColor} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-ink">
                    {row.member.name} · {row.date}
                  </p>
                  <p className="truncate text-[12px] text-ink/45">
                    {row.reason}
                    {row.reviewedBy && ` · decided by ${row.reviewedBy}`}
                  </p>
                </div>
                <Badge size="sm" tone={row.status === "APPROVED" ? "success" : "danger"}>
                  {row.status === "APPROVED" ? "Approved" : "Declined"}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
