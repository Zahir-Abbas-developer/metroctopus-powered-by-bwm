"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Scale } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";

/**
 * "I don't think that's right."
 *
 * Sits on the member's own ledger rows, next to the charge it is about — the
 * moment of disagreement is when someone is looking at the deduction, not
 * later when they have to remember to go and find a form.
 *
 * Only rendered for charges inside the dispute window, and only on a member's
 * own timeline. The API enforces both again.
 */
export function DisputeButton({
  scoreEventId,
  eventReason,
  points,
  existingStatus,
}: {
  scoreEventId: string;
  eventReason: string;
  points: number;
  /** Set once a dispute exists, so the button becomes a status. */
  existingStatus?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (existingStatus) {
    return (
      <span className="shrink-0 rounded-pill border border-line bg-white px-2 py-0.5 text-[10px] font-medium text-ink/50">
        {existingStatus === "OPEN"
          ? "Disputed"
          : existingStatus === "REVERSED"
            ? "Reversed"
            : "Upheld"}
      </span>
    );
  }

  async function file() {
    setBusy(true);
    try {
      const response = await fetch("/api/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoreEventId, reason: reason.trim() }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't file that.");
        return;
      }

      toast.success("Filed. You'll get a written answer either way.");
      setOpen(false);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 rounded-pill border border-line bg-white px-2 py-0.5 text-[10px] font-medium text-ink/45 transition-colors hover:border-ink/25 hover:text-ink"
      >
        Dispute
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Dispute this charge">
        <div className="space-y-4">
          <div className="flex items-start gap-2.5 rounded-card border border-line bg-cream/50 px-4 py-3">
            <Scale className="mt-0.5 h-4 w-4 shrink-0 text-ink/40" />
            <div className="min-w-0">
              <p className="text-[13px] font-medium text-ink">
                {Math.abs(points)} points — {eventReason}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
                Whichever way this goes, the original event stays on the ledger and
                you get the reasoning in writing.
              </p>
            </div>
          </div>

          <Textarea
            label="What actually happened"
            requiredMark
            rows={5}
            autoFocus
            value={reason}
            placeholder="The client's ad account access didn't come through until the 14th — I've attached the email. The deadline was set assuming the 11th."
            onChange={(event) => setReason(event.target.value)}
            hint="Be specific. Dates, names and what you were waiting on are what make a case."
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={busy} disabled={reason.trim().length < 20} onClick={() => void file()}>
              File the dispute
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
