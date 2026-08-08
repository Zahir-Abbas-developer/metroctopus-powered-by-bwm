"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { LOST_REASONS, LOST_REASON_LABEL, type LostReason } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";
import type { PipelineLead } from "@/components/pipeline/PipelineBoard";

/**
 * Marking a deal lost.
 *
 * A fixed reason plus free text, and the reason is mandatory. Free text alone
 * is unqueryable, and the entire value of recording a loss is being able to
 * count them: six deals lost on price in a quarter is a pricing decision, and
 * six paragraphs about six conversations is nothing at all.
 */
export function LostDialog({
  lead,
  onClose,
  onConfirm,
}: {
  lead: PipelineLead | null;
  onClose: () => void;
  onConfirm: (reason: LostReason, note: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<LostReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!lead) return;
    setReason(null);
    setNote("");
  }, [lead]);

  return (
    <Modal
      open={lead !== null}
      onClose={onClose}
      title={lead ? `Why did ${lead.businessName} not close?` : "Deal lost"}
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink/60">
          This is the one number worth having about deals that didn&rsquo;t land.
          Pick the closest reason — the note carries the detail.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {LOST_REASONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setReason(option)}
              className={cn(
                "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                reason === option
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-white text-ink/55 hover:border-ink/25",
              )}
            >
              {LOST_REASON_LABEL[option]}
            </button>
          ))}
        </div>

        <Textarea
          label="What happened"
          rows={3}
          value={note}
          placeholder="Went with an in-house hire after the second call. Said the retainer was right but the timing wasn't."
          onChange={(event) => setNote(event.target.value)}
          hint="Optional, but the thing you'll want in six months."
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={!reason}
            loading={busy}
            onClick={async () => {
              if (!reason) return;
              setBusy(true);
              try {
                await onConfirm(reason, note.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            Mark lost
          </Button>
        </div>
      </div>
    </Modal>
  );
}
