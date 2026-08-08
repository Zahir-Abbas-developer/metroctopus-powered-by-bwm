"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { manualAdjustSchema, fieldErrors } from "@/lib/validation";

/**
 * A hand-applied score change. The written reason is mandatory — these appear
 * distinctly in the ledger and are attributed to whoever made them, so a
 * manual change can always be traced back to a person and a justification.
 */
export function ManualAdjustButton({
  userId,
  memberName,
}: {
  userId: string;
  memberName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setPoints("");
    setReason("");
    setErrors({});
    setFormError(null);
  }

  async function submit() {
    setFormError(null);

    const parsed = manualAdjustSchema.safeParse({
      userId,
      points: Number(points),
      reason,
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/score-events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        setFormError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setFormError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={<SlidersHorizontal className="h-3.5 w-3.5" />}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        Adjust score
      </Button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        busy={saving}
        size="sm"
        eyebrow="Manual adjustment"
        title={`Adjust ${memberName}'s score`}
        description="Use this for things the automatic rules can't see — not to undo a deduction you disagree with."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submit} loading={saving}>
              Record adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
            >
              <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <Input
            label="Points"
            type="number"
            step={0.5}
            requiredMark
            placeholder="-2 or +3"
            value={points}
            onChange={(event) => setPoints(event.target.value)}
            error={errors.points}
            disabled={saving}
            hint="Negative to deduct, positive to credit. Whole or half points."
          />

          <Textarea
            label="Reason"
            requiredMark
            rows={4}
            placeholder="Covered for a colleague on the Lumen launch over the weekend."
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errors.reason}
            disabled={saving}
            hint="Permanent, attributed to you, and visible to the member."
          />
        </div>
      </Modal>
    </>
  );
}
