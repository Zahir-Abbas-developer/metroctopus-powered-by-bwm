"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { DynamicFields } from "@/components/fields/DynamicFields";
import { displayValue, isVisible } from "@/lib/fields";
import type { FieldDefinitionView, FieldValueMap } from "@/lib/fields";

/**
 * A record's department-specific answers, read and edited in place.
 *
 * Reading and editing share one definition list, so a conditional field cannot
 * be shown as read-only and then vanish on edit. Answers that are empty are
 * still listed while editing — the question was asked of this department, and
 * hiding unanswered ones would make the form look different every visit.
 *
 * When reading, empty answers are omitted: a profile of "not set" repeated
 * eight times says less than the four facts that are actually known.
 */
export function RecordFieldsPanel({
  endpoint,
  title = "Department details",
  description,
  canEdit,
}: {
  /** `/api/clients/<id>/fields` — GET returns definitions and values, PATCH writes. */
  endpoint: string;
  title?: string;
  description?: string;
  canEdit: boolean;
}) {
  const toast = useToast();
  const [definitions, setDefinitions] = useState<FieldDefinitionView[] | null>(null);
  const [values, setValues] = useState<FieldValueMap>({});
  const [draft, setDraft] = useState<FieldValueMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) {
      setDefinitions([]);
      return;
    }
    const body = await response.json().catch(() => ({}));
    setDefinitions(body.fields ?? []);
    setValues(body.values ?? {});
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setErrors({});
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: draft }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save those details.");
        return;
      }

      setDefinitions(body.fields ?? []);
      setValues(body.values ?? {});
      setEditing(false);
      toast.success("Details updated.");
    } finally {
      setSaving(false);
    }
  }

  if (definitions === null) {
    return (
      <Card>
        <Skeleton className="h-32" />
      </Card>
    );
  }

  // A department with no definitions of its own renders nothing at all, rather
  // than an empty panel with a heading over it.
  if (definitions.length === 0) return null;

  const shown = definitions.filter((definition) => isVisible(definition, values, definitions));
  const answered = shown.filter((definition) => (values[definition.key] ?? "") !== "");

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          canEdit &&
          !editing && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => {
                setDraft(values);
                setErrors({});
                setEditing(true);
              }}
            >
              Edit
            </Button>
          )
        }
      />

      {editing ? (
        <div className="mt-5 space-y-4">
          <DynamicFields
            definitions={definitions}
            values={draft}
            errors={errors}
            disabled={saving}
            onChange={(key, value) => {
              setDraft((current) => ({ ...current, [key]: value }));
              setErrors((current) => {
                if (!current[key]) return current;
                const next = { ...current };
                delete next[key];
                return next;
              });
            }}
          />

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void save()}>
              Save details
            </Button>
          </div>
        </div>
      ) : answered.length === 0 ? (
        <p className="mt-4 text-[13px] text-ink/50">
          Nothing recorded yet for this business line.
        </p>
      ) : (
        <dl className="mt-5 grid gap-x-6 gap-y-4 sm:grid-cols-2">
          {answered.map((definition) => (
            <div key={definition.id}>
              <dt className="eyebrow text-ink/40">{definition.label}</dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm text-ink">
                {displayValue(definition, values[definition.key])}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}
