"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Tabs } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import {
  FIELD_ENTITIES,
  FIELD_ENTITY_LABEL,
  FIELD_TYPES,
  FIELD_TYPE_LABEL,
  type FieldEntity,
  type FieldType,
} from "@/lib/constants";
import { parseOptions, serializeOptions, typeTakesOptions } from "@/lib/fields";
import type { DepartmentView } from "@/lib/departments";

/**
 * The questions one department asks about a lead or a client.
 *
 * Edited as a list and saved as a list: the order of the rows *is* the display
 * order, and the whole set is sent, so two admins editing at once converge on a
 * list rather than on a half-applied set of moves. Same reasoning, and the same
 * endpoint shape, as the department membership editor next to it.
 */

type Row = {
  id?: string;
  label: string;
  type: FieldType;
  options: string;
  helpText: string;
  required: boolean;
  isActive: boolean;
  showIfKey: string;
  showIfValues: string;
  /** Present once saved — what answers are stored against. */
  key?: string;
};

export function DepartmentFieldsModal({
  open,
  department,
  onClose,
}: {
  open: boolean;
  department: DepartmentView | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [entity, setEntity] = useState<FieldEntity>("LEAD");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async (which: FieldEntity) => {
      if (!department) return;
      setRows(null);
      setErrors({});
      const response = await fetch(
        `/api/departments/${department.id}/fields?entity=${which}`,
      );
      const body = await response.json().catch(() => ({}));
      setRows(
        (body.fields ?? []).map(
          (field: {
            id: string;
            key: string;
            label: string;
            type: FieldType;
            options: string[];
            helpText: string | null;
            required: boolean;
            isActive: boolean;
            showIfKey: string | null;
            showIfValues: string[];
          }) => ({
            id: field.id,
            key: field.key,
            label: field.label,
            type: field.type,
            options: serializeOptions(field.options),
            helpText: field.helpText ?? "",
            required: field.required,
            isActive: field.isActive,
            showIfKey: field.showIfKey ?? "",
            showIfValues: serializeOptions(field.showIfValues),
          }),
        ),
      );
    },
    [department],
  );

  useEffect(() => {
    if (!open || !department) return;
    setEntity("LEAD");
    void load("LEAD");
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

  async function save() {
    if (!department || !rows) return;
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch(`/api/departments/${department.id}/fields`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entity,
          fields: rows.map((row) => ({
            ...(row.id ? { id: row.id } : {}),
            label: row.label,
            type: row.type,
            options: typeTakesOptions(row.type) ? parseOptions(row.options) : [],
            helpText: row.helpText || null,
            required: row.required,
            isActive: row.isActive,
            showIfKey: row.showIfKey || null,
            showIfValues: row.showIfKey ? parseOptions(row.showIfValues) : [],
          })),
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save those fields.");
        return;
      }

      toast.success(`${department.shortLabel} ${FIELD_ENTITY_LABEL[entity].toLowerCase()} fields saved.`);
      void load(entity);
    } finally {
      setSaving(false);
    }
  }

  if (!department) return null;

  /** Only saved fields can be depended on — an unsaved row has no key yet. */
  const conditionSources = (rows ?? []).filter((row) => row.key);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${department.shortLabel} fields`}
      eyebrow="Settings"
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button loading={saving} disabled={rows === null} onClick={() => void save()}>
            Save fields
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Tabs
          items={FIELD_ENTITIES.map((value) => ({
            key: value,
            label: FIELD_ENTITY_LABEL[value],
          }))}
          active={entity}
          onChange={(next) => {
            setEntity(next);
            void load(next);
          }}
        />

        <p className="text-[13px] leading-relaxed text-ink/55">
          These are the questions {department.shortLabel} asks about a{" "}
          {FIELD_ENTITY_LABEL[entity].toLowerCase()}, on top of the name, contact,
          stage, assignee and follow-up every record carries. Removing a field
          deletes the answers recorded against it; switching it off keeps them and
          stops asking.
        </p>

        {errors.fields && (
          <p className="rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] text-danger">
            {errors.fields}
          </p>
        )}

        {rows === null ? (
          <div className="space-y-2">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No department-specific fields yet"
            description="Add one to capture what this business line needs and no other does."
          />
        ) : (
          <div className="space-y-3">
            {rows.map((row, index) => (
              <div
                key={row.id ?? `new-${index}`}
                className="rounded-card border border-line bg-white p-4"
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    label="Label"
                    value={row.label}
                    onChange={(event) => update(index, { label: event.target.value })}
                  />
                  <Select
                    label="Type"
                    value={row.type}
                    onChange={(event) =>
                      update(index, { type: event.target.value as FieldType })
                    }
                    options={FIELD_TYPES.map((type) => ({
                      value: type,
                      label: FIELD_TYPE_LABEL[type],
                    }))}
                  />

                  {typeTakesOptions(row.type) && (
                    <div className="sm:col-span-2">
                      <Input
                        label="Options"
                        value={row.options}
                        hint="Comma-separated, in the order they should appear"
                        onChange={(event) => update(index, { options: event.target.value })}
                      />
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <Input
                      label="Help text"
                      value={row.helpText}
                      hint="Optional — shown under the field"
                      onChange={(event) => update(index, { helpText: event.target.value })}
                    />
                  </div>

                  {/* Conditional visibility: ask this only when another answer
                      calls for it. */}
                  <Select
                    label="Only show when"
                    value={row.showIfKey}
                    onChange={(event) => update(index, { showIfKey: event.target.value })}
                    options={[
                      { value: "", label: "Always show" },
                      ...conditionSources
                        .filter((source) => source.key !== row.key)
                        .map((source) => ({
                          value: source.key!,
                          label: source.label,
                        })),
                    ]}
                  />
                  <Input
                    label="…is one of"
                    value={row.showIfValues}
                    disabled={!row.showIfKey}
                    hint="Comma-separated"
                    onChange={(event) => update(index, { showIfValues: event.target.value })}
                  />
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-[13px] text-ink/70">
                      <input
                        type="checkbox"
                        checked={row.required}
                        onChange={(event) => update(index, { required: event.target.checked })}
                        className="h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
                      />
                      Required
                    </label>
                    <label className="flex items-center gap-2 text-[13px] text-ink/70">
                      <input
                        type="checkbox"
                        checked={row.isActive}
                        onChange={(event) => update(index, { isActive: event.target.checked })}
                        className="h-4 w-4 rounded border-line text-brand focus:ring-brand/25"
                      />
                      Active
                    </label>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${row.label || "field"} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                      className="rounded-[8px] border border-line p-1.5 text-ink/60 transition-colors hover:bg-cream disabled:opacity-30"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${row.label || "field"} down`}
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

        <Button
          variant="ghost"
          icon={<Plus className="h-4 w-4" />}
          disabled={rows === null}
          onClick={() =>
            setRows((current) => [
              ...(current ?? []),
              {
                label: "",
                type: "TEXT",
                options: "",
                helpText: "",
                required: false,
                isActive: true,
                showIfKey: "",
                showIfValues: "",
              },
            ])
          }
        >
          Add a field
        </Button>
      </div>
    </Modal>
  );
}
