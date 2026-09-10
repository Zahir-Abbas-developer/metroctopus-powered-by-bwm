"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { addDays, toDateInput } from "@/lib/date";
import {
  ACTIVITY_TYPE_LABEL,
  LOGGABLE_ACTIVITY_TYPES,
  type ActivityType,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

type Row = {
  id: string;
  title: string;
  dueAt: string | null;
  record: { id: string; name: string; type: "LEAD" | "CLIENT" } | null;
};

const SNOOZES = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 days" },
  { days: 7, label: "Next week" },
] as const;

/**
 * What happened, and when we speak next.
 *
 * The second question is not optional, and that is the whole design. Clearing a
 * follow-up with nothing behind it is how a lead goes quiet — so this asks for
 * the next date, or for an explicit "closing it out" if there genuinely is no
 * next conversation. Snoozing is offered plainly beside it, because "not today"
 * is an honest answer and pretending otherwise just teaches people to lie to
 * the checkbox.
 */
export function FollowUpDialog({
  row,
  onClose,
  onSaved,
}: {
  row: Row | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [activityType, setActivityType] = useState<ActivityType>("CALL");
  const [note, setNote] = useState("");
  const [nextAt, setNextAt] = useState("");
  const [close, setClose] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!row) return;
    setActivityType("CALL");
    setNote("");
    // Default a week out — a date already in the box is one less reason to
    // reach for "close it out" just to get the dialog shut.
    setNextAt(toDateInput(addDays(new Date(), 7)));
    setClose(false);
    setErrors({});
  }, [row]);

  async function send(body: Record<string, unknown>) {
    if (!row?.record) return;
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch("/api/follow-ups", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: row.record.type,
          recordId: row.record.id,
          ...body,
        }),
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (payload?.fields) setErrors(payload.fields);
        toast.error(payload?.error ?? "Couldn't save that.");
        return;
      }

      toast.success("Follow-up updated.");
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  if (!row?.record) return null;

  return (
    <Modal
      open={Boolean(row)}
      onClose={onClose}
      title={`Follow up with ${row.record.name}`}
      eyebrow="Follow-up"
    >
      <div className="space-y-5">
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">Not today?</p>
          <div className="flex flex-wrap gap-1.5">
            {SNOOZES.map((option) => (
              <button
                key={option.days}
                type="button"
                disabled={saving}
                onClick={() => void send({ action: "snooze", days: option.days })}
                className={cn(
                  "rounded-pill border border-line bg-white px-3 py-1.5 text-[13px] text-ink/60 transition-colors",
                  "hover:border-ink/25 hover:text-ink disabled:opacity-50",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="border-t border-line pt-5">
          <p className="mb-3 text-[13px] font-medium text-ink/80">
            Or log what happened
          </p>

          <div className="space-y-4">
            <Select
              label="What was it"
              value={activityType}
              onChange={(event) => setActivityType(event.target.value as ActivityType)}
              options={LOGGABLE_ACTIVITY_TYPES.map((type) => ({
                value: type,
                label: ACTIVITY_TYPE_LABEL[type],
              }))}
            />

            <Textarea
              label="Note"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Spoke to the operations manager — sending a revised quote Thursday."
            />

            <Input
              label="Next follow-up"
              type="date"
              value={nextAt}
              disabled={close}
              error={errors.nextFollowUpAt}
              onChange={(event) => setNextAt(event.target.value)}
              hint="When should we speak next?"
            />

            <label className="flex items-start gap-2.5 text-[13px] text-ink/70">
              <input
                type="checkbox"
                checked={close}
                onChange={(event) => setClose(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
              />
              <span>
                No further follow-up needed
                <span className="mt-0.5 block text-ink/45">
                  Only tick this if the conversation is genuinely finished — it
                  stops the reminders entirely.
                </span>
              </span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            loading={saving}
            onClick={() =>
              void send({
                action: "log",
                activityType,
                note,
                ...(close ? { close: true } : { nextFollowUpAt: nextAt }),
              })
            }
          >
            Save
          </Button>
        </div>
      </div>
    </Modal>
  );
}
