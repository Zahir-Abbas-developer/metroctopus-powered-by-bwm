"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  DEPARTMENT_COLOR_TOKENS,
  DEPARTMENT_COLOR_LABEL,
  STAGE_KINDS,
  STAGE_KIND_LABEL,
  type StageKind,
} from "@/lib/constants";
import type { DepartmentView } from "@/lib/departments";

/**
 * A department's board columns.
 *
 * Ordering is arrow-driven rather than pointer-drag, for the same reason the
 * department list is: it is edited rarely, and a keyboard-reachable control
 * that works on a phone beats a drag handle needing a mouse plus a fallback.
 *
 * Retiring a stage that still holds deals asks where they go. The server
 * refuses the save with a 409 until told, and moves them in the same
 * transaction — a board that silently stops showing four deals is worse than an
 * edit that will not go through.
 */

type Row = {
  id?: string;
  key?: string;
  label: string;
  kind: StageKind;
  colorToken: string;
  isActive: boolean;
};

export function DepartmentPipelineModal({
  open,
  department,
  onClose,
  onSaved,
}: {
  open: boolean;
  department: DepartmentView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [original, setOriginal] = useState<Row[]>([]);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!department) return;
    setRows(null);
    setErrors({});
    setMoveTo({});

    const response = await fetch(`/api/departments/${department.id}/stages`);
    const body = await response.json().catch(() => ({}));
    const mapped: Row[] = (body.stages ?? []).map(
      (stage: {
        id: string;
        key: string;
        label: string;
        kind: StageKind;
        colorToken: string | null;
        isActive: boolean;
      }) => ({
        id: stage.id,
        key: stage.key,
        label: stage.label,
        kind: stage.kind,
        colorToken: stage.colorToken ?? "neutral",
        isActive: stage.isActive,
      }),
    );
    setRows(mapped);
    setOriginal(mapped);
  }, [department]);

  useEffect(() => {
    if (!open || !department) return;
    void load();
  }, [open, department, load]);

  function update(index: number, patch: Partial<Row>) {
    setRows((current) =>
      current ? current.map((row, i) => (i === index ? { ...row, ...patch } : row)) : current,
    );
    setErrors({});
  }

  function move(index: number, direction: -1 | 1) {
    setRows((current) => {
      if (!current) return current;
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  /** Stages that were active and are being removed or switched off. */
  const retiring = (original ?? []).filter((stage) => {
    if (!stage.isActive) return false;
    const kept = (rows ?? []).find((row) => row.id === stage.id);
    return !kept || !kept.isActive;
  });

  const destinations = (rows ?? []).filter((row) => row.isActive && row.id);

  async function save() {
    if (!department || !rows) return;
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch(`/api/departments/${department.id}/stages`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stages: rows.map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            label: row.label,
            kind: row.kind,
            colorToken: row.colorToken,
            isActive: row.isActive,
          })),
          moveTo,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save that pipeline.");
        return;
      }

      toast.success(`${department.shortLabel} pipeline saved.`);
      onSaved();
      void load();
    } finally {
      setSaving(false);
    }
  }

  if (!department) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${department.shortLabel} pipeline`}
      eyebrow="Settings"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button loading={saving} disabled={rows === null} onClick={() => void save()}>
            Save pipeline
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-[13px] leading-relaxed text-ink/55">
          These are {department.shortLabel}&rsquo;s board columns, in order. A
          stage&rsquo;s <em>kind</em> is what the app reads — reaching a winning
          stage converts the deal and notifies, and a losing one asks for a
          reason — so renaming a stage never changes what it means.
        </p>

        {errors.stages && (
          <p className="rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] text-danger">
            {errors.stages}
          </p>
        )}

        {rows === null ? (
          <div className="space-y-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div
                key={row.id ?? `new-${index}`}
                className="rounded-card border border-line bg-white p-4"
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <Input
                    label="Label"
                    value={row.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                  />
                  <Select
                    label="Kind"
                    value={row.kind}
                    onChange={(event) =>
                      update(index, { kind: event.target.value as StageKind })
                    }
                    options={STAGE_KINDS.map((kind) => ({
                      value: kind,
                      label: STAGE_KIND_LABEL[kind],
                    }))}
                  />
                  <Select
                    label="Colour"
                    value={row.colorToken}
                    onChange={(event) => update(index, { colorToken: event.target.value })}
                    options={DEPARTMENT_COLOR_TOKENS.map((token) => ({
                      value: token,
                      label: DEPARTMENT_COLOR_LABEL[token],
                    }))}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <label className="flex items-center gap-2 text-[13px] text-ink/70">
                    <input
                      type="checkbox"
                      checked={row.isActive}
                      onChange={(event) => update(index, { isActive: event.target.checked })}
                      className="h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
                    />
                    Active
                  </label>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${row.label || "stage"} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="rounded-[8px] border border-line p-1.5 text-ink/60 transition-colors hover:bg-cream disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${row.label || "stage"} down`}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                      className="rounded-[8px] border border-line p-1.5 text-ink/60 transition-colors hover:bg-cream disabled:opacity-30"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() =>
                        setRows((current) =>
                          current ? current.filter((_, i) => i !== index) : current,
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Only appears once something is actually being retired, and only asks
            about the stages that hold records. */}
        {retiring.length > 0 && destinations.length > 0 && (
          <div className="rounded-card border border-warn/20 bg-warn-tint p-4">
            <p className="text-[13px] font-medium text-warn">
              Where should their deals go?
            </p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink/60">
              Any deal still sitting on a stage you are retiring is moved to the
              stage you pick, in the same save.
            </p>
            <div className="mt-3 space-y-3">
              {retiring.map((stage) => (
                <Select
                  key={stage.id}
                  label={stage.label}
                  value={moveTo[stage.id!] ?? ""}
                  onChange={(event) =>
                    setMoveTo((current) => ({ ...current, [stage.id!]: event.target.value }))
                  }
                  placeholder="Choose a destination"
                  options={destinations
                    .filter((row) => row.id !== stage.id)
                    .map((row) => ({ value: row.id!, label: row.label }))}
                />
              ))}
            </div>
          </div>
        )}

        <Button
          variant="ghost"
          icon={<Plus className="h-4 w-4" />}
          disabled={rows === null}
          onClick={() =>
            setRows((current) => [
              ...(current ?? []),
              { label: "", kind: "OPEN", colorToken: "neutral", isActive: true },
            ])
          }
        >
          Add a stage
        </Button>
      </div>
    </Modal>
  );
}
