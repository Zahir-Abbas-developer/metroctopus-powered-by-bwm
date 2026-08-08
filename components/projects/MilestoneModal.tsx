"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { WeightDots } from "@/components/ui/WeightDots";
import { WEIGHT_LABEL, WEIGHT_MAX, WEIGHT_MIN } from "@/lib/constants";
import { toDateInput } from "@/lib/date";
import { createMilestoneSchema, fieldErrors, milestoneFieldsSchema } from "@/lib/validation";
import type { MilestoneRow } from "@/lib/types";
import type { MemberOption } from "@/components/projects/MilestoneRowItem";
import { AssigneePicker } from "@/components/capacity/AssigneePicker";

const WEIGHT_OPTIONS = Array.from({ length: WEIGHT_MAX - WEIGHT_MIN + 1 }, (_, index) => {
  const weight = WEIGHT_MIN + index;
  return { value: String(weight), label: `${weight} — ${WEIGHT_LABEL[weight]}` };
});

export function MilestoneModal({
  open,
  moduleId,
  moduleName,
  milestone,
  members,
  defaultDueDate,
  serviceSlug,
  onClose,
  onSaved,
}: {
  open: boolean;
  moduleId: string;
  moduleName: string;
  /** Present when editing; absent when adding. */
  milestone: MilestoneRow | null;
  members: MemberOption[];
  defaultDueDate: string;
  /** The module's service, so the picker knows who is qualified. */
  serviceSlug?: string | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const editing = Boolean(milestone);
  const [draft, setDraft] = useState(() => toDraft(milestone, defaultDueDate));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(milestone, defaultDueDate));
    setErrors({});
    setFormError(null);
  }, [open, milestone, defaultDueDate]);

  function set<K extends keyof ReturnType<typeof toDraft>>(
    key: K,
    value: ReturnType<typeof toDraft>[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const payload = {
      title: draft.title,
      description: draft.description || undefined,
      weight: Number(draft.weight),
      dueDate: draft.dueDate,
      assigneeId: draft.assigneeId || null,
    };

    const parsed = editing
      ? milestoneFieldsSchema.safeParse(payload)
      : createMilestoneSchema.safeParse({ ...payload, moduleId });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(
        editing ? `/api/milestones/${milestone!.id}` : "/api/milestones",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        },
      );
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        setFormError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      onSaved(editing ? "Milestone updated." : "Milestone added.");
    } catch {
      setFormError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  const weight = Number(draft.weight);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      eyebrow={editing ? "Edit milestone" : `Add to ${moduleName}`}
      title={editing ? milestone!.title : "New milestone"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="milestone-form" loading={saving}>
            {editing ? "Save changes" : "Add milestone"}
          </Button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={onSubmit} noValidate className="space-y-4">
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
          label="Title"
          requiredMark
          placeholder="Campaign structure & launch"
          value={draft.title}
          onChange={(event) => set("title", event.target.value)}
          error={errors.title}
          disabled={saving}
        />

        <Textarea
          label="Description"
          rows={3}
          placeholder="What has to be true for this to count as done."
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
          error={errors.description}
          disabled={saving}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Due date"
            type="date"
            requiredMark
            value={draft.dueDate}
            onChange={(event) => set("dueDate", event.target.value)}
            error={errors.dueDate}
            disabled={saving}
            hint="Due by the end of this day, Karachi time."
          />

          <div>
            <Select
              label="Weight"
              requiredMark
              options={WEIGHT_OPTIONS}
              value={draft.weight}
              onChange={(event) => set("weight", event.target.value)}
              error={errors.weight}
              disabled={saving}
            />
            <div className="mt-2 flex items-center gap-2">
              <WeightDots weight={weight} />
              <span className="text-[12px] text-ink/45">
                Missing this costs {weight * 4} points
              </span>
            </div>
          </div>
        </div>

        <Input
          label="Estimated hours"
          type="number"
          min={0}
          max={200}
          value={draft.estimatedHours}
          onChange={(event) => set("estimatedHours", event.target.value)}
          error={errors.estimatedHours}
          disabled={saving}
          hint="Rough effort. Drives the capacity bars below — it doesn't affect scoring."
        />

        {/* Capacity is shown at the moment of assignment rather than on a page
            somebody would have to think to open. Overload is cheaper to
            prevent than to diagnose from the misses it causes. */}
        <AssigneePicker
          dueDate={draft.dueDate}
          estimatedHours={Number(draft.estimatedHours) || 2}
          serviceSlug={serviceSlug}
          excludeMilestoneId={milestone?.id ?? null}
          value={draft.assigneeId || null}
          onChange={(userId) => set("assigneeId", userId ?? "")}
        />
        <p className="-mt-2 text-[12px] text-ink/45">
          Only the assignee&rsquo;s score is affected by this milestone.
        </p>
      </form>
    </Modal>
  );
}

function toDraft(milestone: MilestoneRow | null, defaultDueDate: string) {
  return {
    title: milestone?.title ?? "",
    description: milestone?.description ?? "",
    weight: String(milestone?.weight ?? 3),
    dueDate: milestone ? toDateInput(milestone.dueDate) : defaultDueDate,
    estimatedHours: String(milestone?.estimatedHours ?? 2),
    assigneeId: milestone?.assignee?.id ?? "",
  };
}
