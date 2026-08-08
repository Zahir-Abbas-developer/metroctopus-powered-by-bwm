"use client";

import { useEffect, useState } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { WeightDots } from "@/components/ui/WeightDots";
import { rejectionDeduction, formatPoints } from "@/lib/scoring";
import type { MilestoneRow } from "@/lib/types";

/**
 * Rejecting submitted work charges the assignee points, so the dialog states
 * the cost up front and refuses to send without a written reason.
 */
export function RejectModal({
  milestone,
  onClose,
  onConfirm,
}: {
  milestone: MilestoneRow | null;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!milestone) return;
    setReason("");
    setError(null);
  }, [milestone]);

  async function submit() {
    if (reason.trim().length < 5) {
      setError("Say what needs reworking — the member is charged points for this.");
      return;
    }

    setSaving(true);
    setError(null);
    const ok = await onConfirm(reason.trim());
    setSaving(false);
    if (!ok) setError("Couldn't send this back. Please try again.");
  }

  const cost = milestone ? rejectionDeduction(milestone.weight) : 0;

  return (
    <Modal
      open={Boolean(milestone)}
      onClose={onClose}
      busy={saving}
      size="sm"
      eyebrow="Send back for rework"
      title={milestone?.title ?? ""}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={saving}>
            Reject work
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {milestone && (
          <div className="flex items-center justify-between gap-4 rounded-[10px] border border-line bg-cream px-3.5 py-3">
            <div className="flex items-center gap-2.5">
              <WeightDots weight={milestone.weight} />
              <span className="text-[13px] text-ink/60">
                Assigned to {milestone.assignee?.name ?? "nobody"}
              </span>
            </div>
            <span className="rounded-pill border border-danger/20 bg-danger-tint px-2 py-0.5 text-[11px] font-bold tabular-nums text-danger">
              {formatPoints(cost)}
            </span>
          </div>
        )}

        <Textarea
          label="What needs to change"
          requiredMark
          rows={4}
          autoFocus
          placeholder="The numbers in the report don't reconcile with the ad account."
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={error ?? undefined}
          disabled={saving}
          hint="Stored on the member's score record, so it needs to stand on its own."
        />

        {milestone && (
          <div className="flex items-start gap-2.5 rounded-[10px] border border-warn/20 bg-warn-tint px-3.5 py-3 text-[13px] leading-relaxed text-warn">
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              This moves the milestone back to In progress and charges{" "}
              {milestone.assignee?.name ?? "the assignee"} {Math.abs(cost)} points.
              Rejecting again charges again.
            </span>
          </div>
        )}
      </div>
    </Modal>
  );
}
