"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Trophy } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDate } from "@/lib/date";
import { formatPoints } from "@/lib/scoring";
import { cn } from "@/lib/utils";

type Award = {
  id: string;
  type: string;
  year: number;
  month: number;
  streakMonths: number;
  bonusAmount: number | null;
  bonusPercent: number | null;
  actionedAt: string | null;
  actionedNote: string | null;
  createdAt: string;
  member: { id: string; name: string; avatarColor: string; jobTitle: string };
  evidence: {
    months?: { year: number; month: number; score: number; active: boolean }[];
    events?: { type: string; points: number; reason: string; at: string }[];
    attendance?: { present: number; late: number; absent: number };
    disputes?: { status: string; reason: string }[];
  };
};

/**
 * The owner's incentive queue.
 *
 * Two lists that read very differently on purpose. A bonus is a decision about
 * money and belongs beside a field for the amount. A review is a decision
 * about a conversation, and belongs beside the evidence that raised it — which
 * is frozen at the moment it was raised, so the conversation two weeks later
 * is about the same numbers.
 */
export function IncentiveQueue() {
  const toast = useToast();
  const [awards, setAwards] = useState<Award[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [open, setOpen] = useState<Award | null>(null);
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/incentives", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const body = (await response.json()) as { awards: Award[] };
      setAwards(body.awards);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function action(award: Award) {
    setBusy(true);
    try {
      const response = await fetch("/api/incentives", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: award.id,
          bonusAmount: amount === "" ? null : Number(amount),
          bonusPercent: percent === "" ? null : Number(percent),
          note: note.trim() || null,
          actioned: true,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body?.error ?? "That didn't work.");
        return;
      }

      toast.success("Recorded.");
      setOpen(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Skeleton className="h-[420px] rounded-card" />;

  if (state === "error") {
    return (
      <Card padded={false}>
        <ErrorState title="Couldn't load incentives" description="This is usually temporary." onRetry={() => void load()} />
      </Card>
    );
  }

  const bonuses = awards.filter((row) => row.type === "EXCELLENCE_STREAK");
  const reviews = awards.filter((row) => row.type === "PERFORMANCE_REVIEW");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Month close"
        title="Incentives"
        description="Evaluated automatically when a month closes. Amounts here are a payroll reference — this app never moves money."
      />

      <Card padded={false}>
        <CardHeader
          title="Bonus eligible"
          description="Members who held the standard for a full run of months"
          action={bonuses.filter((row) => !row.actionedAt).length > 0 ? (
            <Badge tone="success">{bonuses.filter((row) => !row.actionedAt).length}</Badge>
          ) : undefined}
        />

        {bonuses.length === 0 ? (
          <EmptyState
            icon={Trophy}
            eyebrow="Nothing yet"
            title="No bonuses earned"
            description="A member reaching the streak appears here the month they get there."
          />
        ) : (
          <ul className="divide-y divide-line">
            {bonuses.map((award) => (
              <li key={award.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Avatar name={award.member.name} color={award.member.avatarColor} size="md" />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{award.member.name}</p>
                  <p className="truncate text-[12px] text-ink/45">
                    {award.streakMonths} consecutive months · earned{" "}
                    {monthLabel(award.year, award.month)}
                    {award.bonusPercent !== null && ` · ${award.bonusPercent}% reference`}
                  </p>
                </div>

                {award.actionedAt ? (
                  <Badge size="sm" tone="neutral">
                    Actioned {formatDate(award.actionedAt)}
                  </Badge>
                ) : (
                  <Button
                    size="sm"
                    icon={<Check className="h-3.5 w-3.5" />}
                    onClick={() => {
                      setOpen(award);
                      setAmount(award.bonusAmount === null ? "" : String(award.bonusAmount));
                      setPercent(award.bonusPercent === null ? "" : String(award.bonusPercent));
                      setNote("");
                    }}
                  >
                    Record
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padded={false}>
        <CardHeader
          title="Performance reviews"
          description="Raised with the evidence frozen at the moment it triggered"
          action={reviews.filter((row) => !row.actionedAt).length > 0 ? (
            <Badge tone="danger">{reviews.filter((row) => !row.actionedAt).length}</Badge>
          ) : undefined}
        />

        {reviews.length === 0 ? (
          <EmptyState
            icon={AlertTriangle}
            eyebrow="All well"
            title="No reviews raised"
            description="Nobody has hit the threshold. Whatever the team is doing is working."
          />
        ) : (
          <ul className="divide-y divide-line">
            {reviews.map((award) => (
              <li key={award.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <Avatar name={award.member.name} color={award.member.avatarColor} size="md" />

                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ink">{award.member.name}</p>
                    <p className="text-[12px] text-ink/45">
                      {award.streakMonths} low months · raised {monthLabel(award.year, award.month)}
                    </p>

                    {award.evidence.months && (
                      <div className="mt-2.5 flex flex-wrap gap-1.5">
                        {award.evidence.months.map((month) => (
                          <span
                            key={`${month.year}-${month.month}`}
                            className={cn(
                              "rounded-pill border px-2 py-0.5 text-[11px] tabular-nums",
                              !month.active
                                ? "border-line bg-white text-ink/30"
                                : month.score < 60
                                  ? "border-danger/25 bg-danger-tint text-danger"
                                  : "border-line bg-white text-ink/55",
                            )}
                          >
                            {monthLabel(month.year, month.month)} {month.active ? month.score : "—"}
                          </span>
                        ))}
                      </div>
                    )}

                    {award.evidence.attendance && (
                      <p className="mt-2 text-[12px] text-ink/50">
                        Attendance that month: {award.evidence.attendance.present} present,{" "}
                        {award.evidence.attendance.late} late, {award.evidence.attendance.absent} absent
                      </p>
                    )}

                    {award.evidence.events && award.evidence.events.length > 0 && (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[12px] text-ink/50 hover:text-ink">
                          {award.evidence.events.length} score events
                        </summary>
                        <ul className="mt-2 space-y-1 border-l border-line pl-3">
                          {award.evidence.events.slice(0, 12).map((event, index) => (
                            <li key={index} className="text-[12px] text-ink/55">
                              <span className="font-medium tabular-nums text-ink/70">
                                {formatPoints(event.points)}
                              </span>{" "}
                              {event.reason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>

                  {award.actionedAt ? (
                    <Badge size="sm" tone="neutral">
                      Handled
                    </Badge>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setOpen(award);
                        setAmount("");
                        setPercent("");
                        setNote("");
                      }}
                    >
                      Mark handled
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Modal
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open?.type === "EXCELLENCE_STREAK" ? "Record the bonus" : "Mark the review handled"}
      >
        {open && (
          <div className="space-y-4">
            {open.type === "EXCELLENCE_STREAK" ? (
              <>
                <p className="text-[13px] leading-relaxed text-ink/60">
                  A payroll reference for {open.member.name}. Nothing here moves money — it is the
                  record of what you decided.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Input
                    label="Amount"
                    type="number"
                    min={0}
                    icon={<span className="text-[13px]">$</span>}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                  <Input
                    label="Or percent"
                    type="number"
                    min={0}
                    max={100}
                    value={percent}
                    onChange={(event) => setPercent(event.target.value)}
                  />
                </div>
              </>
            ) : (
              <p className="text-[13px] leading-relaxed text-ink/60">
                Marking this handled records that the conversation happened. The evidence stays
                attached either way.
              </p>
            )}

            <Textarea
              label="Note"
              rows={3}
              value={note}
              placeholder={
                open.type === "EXCELLENCE_STREAK"
                  ? "Paid with the December run."
                  : "Spoke on the 4th. Agreed a lighter load next month and a check-in in two weeks."
              }
              onChange={(event) => setNote(event.target.value)}
            />

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(null)}>
                Cancel
              </Button>
              <Button loading={busy} onClick={() => void action(open)}>
                Record
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}
