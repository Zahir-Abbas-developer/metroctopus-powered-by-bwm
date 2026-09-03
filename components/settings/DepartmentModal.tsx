"use client";

import { useEffect, useState } from "react";

import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { DEPARTMENT_COLOR_TOKENS, DEPARTMENT_COLOR_LABEL } from "@/lib/constants";
import type { DepartmentView } from "@/components/settings/DepartmentsManager";

/**
 * Create or edit a department.
 *
 * Deactivation is handled here rather than as a separate destructive action,
 * because switching a department off is only safe once its live records have
 * somewhere to go — and that choice belongs next to the switch that forces it.
 */
export function DepartmentModal({
  open,
  department,
  others,
  onClose,
  onSaved,
}: {
  open: boolean;
  department: DepartmentView | null;
  /** Active departments the records could move to. */
  others: DepartmentView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [shortLabel, setShortLabel] = useState("");
  const [colorToken, setColorToken] = useState<string>("neutral");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [reassignToId, setReassignToId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(department?.name ?? "");
    setShortLabel(department?.shortLabel ?? "");
    setColorToken(department?.colorToken ?? "neutral");
    setDescription(department?.description ?? "");
    setIsActive(department?.isActive ?? true);
    setReassignToId("");
    setErrors({});
  }, [open, department]);

  const live = department ? department.counts.clients + department.counts.leads : 0;
  const needsReassign = Boolean(department) && department!.isActive && !isActive && live > 0;

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const res = await fetch(
        department ? `/api/departments/${department.id}` : "/api/departments",
        {
          method: department ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            shortLabel,
            colorToken: colorToken || null,
            description,
            ...(department ? { isActive } : {}),
            ...(needsReassign ? { reassignToId } : {}),
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrors(data.fields ?? {});
        toast.error(data.error ?? "Couldn't save that department");
        return;
      }

      toast.success(department ? "Department updated" : "Department created");
      onSaved();
    } catch {
      toast.error("Couldn't save that department");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={department ? `Edit ${department.shortLabel}` : "New department"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {department ? "Save changes" : "Create department"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Name"
          requiredMark
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
          placeholder="BWM — Pilot Cars Sales & Dispatch"
        />

        <Input
          label="Short label"
          requiredMark
          value={shortLabel}
          error={errors.shortLabel}
          hint="Used on badges and in narrow columns, where the full name will not fit."
          onChange={(e) => setShortLabel(e.target.value)}
          placeholder="Pilot Cars"
        />

        <Select
          label="Colour"
          value={colorToken}
          onChange={(e) => setColorToken(e.target.value)}
          hint="Tags this department's badge. Drawn from the existing palette."
          options={DEPARTMENT_COLOR_TOKENS.map((token) => ({
            value: token,
            label: DEPARTMENT_COLOR_LABEL[token],
          }))}
        />

        <Textarea
          label="Description"
          value={description}
          error={errors.description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="What this business line covers."
        />

        {department && (
          <div className="rounded-card border border-line bg-cream px-4 py-3.5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-line accent-brand"
              />
              <span className="text-[13px] leading-relaxed text-ink/70">
                <span className="font-medium text-ink">Active</span>
                <br />
                An inactive department stops appearing in pickers and dashboards.
                Its history is kept, and nothing is deleted.
              </span>
            </label>

            {needsReassign && (
              <div className="mt-4 border-t border-line pt-3.5">
                <p className="mb-2 text-[13px] leading-relaxed text-ink/70">
                  {department.shortLabel} still holds{" "}
                  <span className="font-medium text-ink">
                    {department.counts.clients} client
                    {department.counts.clients === 1 ? "" : "s"} and {department.counts.leads}{" "}
                    deal{department.counts.leads === 1 ? "" : "s"}
                  </span>
                  . Choose where they move — they cannot be left without a department.
                </p>
                <Select
                  label="Move records to"
                  requiredMark
                  value={reassignToId}
                  error={errors.reassignToId}
                  onChange={(e) => setReassignToId(e.target.value)}
                  placeholder="Pick a department"
                  options={others.map((d) => ({ value: d.id, label: d.name }))}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
