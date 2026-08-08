"use client";

import { useState } from "react";
import { Ban, PlayCircle, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import {
  BLOCK_REASONS,
  BLOCK_REASON_LABEL,
  describeBlocked,
  type BlockReason,
} from "@/lib/fairness-types";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";

/**
 * Blocking and unblocking from the drawer.
 *
 * Both go through /api/milestones/[id]/block rather than the status endpoint,
 * because entering the state has to open a timed period and leaving it has to
 * close one. A note is mandatory in both directions that matter: the owner
 * cannot act on "blocked" alone, and a veto that costs the member their pause
 * has to say why.
 */
export function BlockControl({
  milestoneId,
  status,
  blockedReason,
  blockedNote,
  blockedMinutes,
  dueDate,
  viewerIsAdmin,
  onChanged,
}: {
  milestoneId: string;
  status: string;
  blockedReason: string | null;
  blockedNote: string | null;
  blockedMinutes: number;
  dueDate: string;
  viewerIsAdmin: boolean;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState<"block" | "veto" | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<BlockReason>("CLIENT");
  const [note, setNote] = useState("");

  const blocked = status === "BLOCKED";
  const shifted =
    blockedMinutes > 0
      ? new Date(new Date(dueDate).getTime() + blockedMinutes * 60_000)
      : null;

  async function block() {
    setBusy(true);
    try {
      const response = await fetch(`/api/milestones/${milestoneId}/block`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't block that.");
        return;
      }

      toast.success("Blocked. The deadline clock is paused until it clears.");
      setOpen(null);
      setNote("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function unblock(veto = false) {
    setBusy(true);
    try {
      const response = await fetch(`/api/milestones/${milestoneId}/block`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(veto ? { veto: true, vetoNote: note } : {}),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't unblock that.");
        return;
      }

      toast.success(
        veto
          ? "Block overruled — the deadline did not move."
          : `Unblocked. ${describeBlocked(body.minutesAdded ?? 0)} added to the deadline.`,
      );
      setOpen(null);
      setNote("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div
        className={cn(
          "rounded-card border p-4",
          blocked ? "border-line bg-cream/60" : "border-line bg-white",
        )}
      >
        {blocked ? (
          <>
            <div className="flex items-start gap-2.5">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium text-ink">
                  {BLOCK_REASON_LABEL[blockedReason as BlockReason] ?? "Blocked"}
                </p>
                <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
                  {blockedNote}
                </p>
                <p className="mt-2 text-[12px] text-ink/45">
                  Paused {describeBlocked(blockedMinutes)}
                  {shifted && ` · due ${formatDate(dueDate)} → ${formatDate(shifted)}`}
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                icon={<PlayCircle className="h-3.5 w-3.5" />}
                onClick={() => void unblock(false)}
              >
                Unblock
              </Button>

              {viewerIsAdmin && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNote("");
                    setOpen("veto");
                  }}
                  icon={<ShieldAlert className="h-3.5 w-3.5" />}
                  className="hover:text-danger"
                >
                  Overrule
                </Button>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">Waiting on someone?</p>
              <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
                Block it and the deadline pauses. You&rsquo;re never charged for
                time you can&rsquo;t act in.
                {shifted && ` Already extended to ${formatDate(shifted)}.`}
              </p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<Ban className="h-3.5 w-3.5" />}
              onClick={() => {
                setNote("");
                setOpen("block");
              }}
            >
              Block
            </Button>
          </div>
        )}
      </div>

      <Modal open={open === "block"} onClose={() => setOpen(null)} title="Block this milestone">
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink/80">What are you waiting on?</p>
            <div className="flex flex-wrap gap-1.5">
              {BLOCK_REASONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setReason(option)}
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                    reason === option
                      ? "border-brand bg-brand text-paper"
                      : "border-line bg-white text-ink/55 hover:border-ink/25",
                  )}
                >
                  {BLOCK_REASON_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <Textarea
            label="What exactly is outstanding"
            rows={3}
            value={note}
            autoFocus
            placeholder="Waiting on the client to approve the ad account access request sent Monday."
            onChange={(event) => setNote(event.target.value)}
            hint="The owner sees this immediately and can overrule it, so be specific."
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={note.trim().length < 10} onClick={() => void block()}>
              Block and pause the clock
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={open === "veto"} onClose={() => setOpen(null)} title="Overrule this block">
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink/60">
            The block period stays on the record — nothing is deleted — but it
            contributes no time, so the original deadline stands.
          </p>

          <Textarea
            label="Why it doesn't stand"
            rows={3}
            value={note}
            autoFocus
            placeholder="The client sent those assets on Tuesday; they're in the shared drive."
            onChange={(event) => setNote(event.target.value)}
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={note.trim().length < 5}
              onClick={() => void unblock(true)}
            >
              Overrule
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
