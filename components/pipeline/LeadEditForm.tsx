"use client";

import { useEffect, useState, type FormEvent } from "react";

import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { DynamicFields } from "@/components/fields/DynamicFields";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, type LeadSource } from "@/lib/pipeline-types";
import type { FieldDefinitionView, FieldValueMap } from "@/lib/fields";
import type { AssignableMember } from "@/lib/assignment";
import { cn } from "@/lib/utils";

/** The id the drawer's footer buttons submit, since they live outside the form. */
export const LEAD_EDIT_FORM_ID = "lead-edit-form";

export type EditableLead = {
  id: string;
  departmentId: string;
  businessName: string;
  contactName: string;
  email: string | null;
  phone: string | null;
  source: string;
  country: string | null;
  interestedServices: string[];
  estimatedMonthlyValue?: number;
  dealValue?: number;
  notes: string | null;
  ownerId: string | null;
};

type Draft = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  country: string;
  source: LeadSource;
  estimatedMonthlyValue: string;
  dealValue: string;
  interestedServices: string[];
  notes: string;
  ownerId: string;
};

function draftFrom(lead: EditableLead): Draft {
  return {
    businessName: lead.businessName,
    contactName: lead.contactName,
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    country: lead.country ?? "",
    source: (LEAD_SOURCES as readonly string[]).includes(lead.source)
      ? (lead.source as LeadSource)
      : "OUTREACH",
    estimatedMonthlyValue: lead.estimatedMonthlyValue ? String(lead.estimatedMonthlyValue) : "",
    dealValue: lead.dealValue ? String(lead.dealValue) : "",
    interestedServices: lead.interestedServices,
    notes: lead.notes ?? "",
    ownerId: lead.ownerId ?? "",
  };
}

/**
 * Editing a lead after it was filed.
 *
 * There was no way to do this at all: the API accepted edits, but the drawer
 * only ever displayed a lead, so a typo in a phone number or a wrong pickup
 * address stayed wrong for good. This is the same set of answers the creation
 * wizard asks — the core details, what they were interested in, and the
 * department's own questions — laid out in one scrolling column so it works at
 * phone width, with the save and cancel buttons in the drawer's footer where
 * they stay on screen however long the form is.
 *
 * Money fields appear only for people allowed to see the deal's value, and the
 * owner can be changed only by an admin; the server enforces both, this just
 * doesn't offer what would be refused.
 */
export function LeadEditForm({
  lead,
  fields,
  fieldValues,
  services,
  canSeeMoney,
  canReassign,
  onSavingChange,
  onSaved,
}: {
  lead: EditableLead;
  fields: FieldDefinitionView[];
  fieldValues: FieldValueMap;
  services: { slug: string; name: string }[];
  canSeeMoney: boolean;
  canReassign: boolean;
  onSavingChange: (saving: boolean) => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(lead));
  const [values, setValues] = useState<FieldValueMap>(fieldValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [assignees, setAssignees] = useState<AssignableMember[]>([]);

  // Only an admin can hand the lead to someone else, so only an admin needs the
  // list of who could take it — the department's members and nobody else.
  useEffect(() => {
    if (!canReassign) return;
    let cancelled = false;
    void (async () => {
      const response = await fetch(`/api/departments/${lead.departmentId}/form?entity=LEAD`).catch(
        () => null,
      );
      const body = response?.ok ? await response.json().catch(() => ({})) : {};
      if (!cancelled) setAssignees(body?.assignees ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [canReassign, lead.departmentId]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearError(key);
  }

  function clearError(key: string) {
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function scrollToFirstError() {
    // The drawer body is the scroller; its first error is what needs attention.
    requestAnimationFrame(() => {
      document
        .querySelector(`#${LEAD_EDIT_FORM_ID} [aria-invalid="true"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const missing: Record<string, string> = {
      ...(draft.businessName.trim().length < 2 ? { businessName: "Give the business a name" } : {}),
      ...(draft.contactName.trim().length < 2 ? { contactName: "Who are we talking to?" } : {}),
    };
    if (Object.keys(missing).length > 0) {
      setErrors(missing);
      scrollToFirstError();
      return;
    }

    onSavingChange(true);
    setErrors({});
    try {
      const response = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: draft.businessName,
          contactName: draft.contactName,
          email: draft.email,
          phone: draft.phone,
          country: draft.country,
          source: draft.source,
          interestedServices: draft.interestedServices,
          notes: draft.notes,
          ...(canSeeMoney
            ? {
                estimatedMonthlyValue: Number(draft.estimatedMonthlyValue || 0),
                dealValue: Number(draft.dealValue || 0),
              }
            : {}),
          ...(canReassign && draft.ownerId && draft.ownerId !== (lead.ownerId ?? "")
            ? { ownerId: draft.ownerId }
            : {}),
          fieldValues: values,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) {
          setErrors(body.fields);
          scrollToFirstError();
        }
        toast.error(body?.error ?? "Couldn't save those changes.");
        return;
      }

      toast.success(
        Array.isArray(body.changed) && body.changed.length === 0
          ? "Nothing had changed."
          : `${draft.businessName} updated.`,
      );
      onSaved();
    } catch {
      toast.error("We couldn't reach the server.");
    } finally {
      onSavingChange(false);
    }
  }

  return (
    <form id={LEAD_EDIT_FORM_ID} onSubmit={submit} noValidate className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Business"
          requiredMark
          value={draft.businessName}
          error={errors.businessName}
          onChange={(event) => set("businessName", event.target.value)}
        />
        <Input
          label="Contact"
          requiredMark
          value={draft.contactName}
          error={errors.contactName}
          onChange={(event) => set("contactName", event.target.value)}
        />
        <Input
          label="Email"
          type="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          value={draft.email}
          error={errors.email}
          onChange={(event) => set("email", event.target.value)}
        />
        <Input
          label="Phone"
          type="tel"
          inputMode="tel"
          value={draft.phone}
          error={errors.phone}
          onChange={(event) => set("phone", event.target.value)}
        />
        <Input
          label="Country"
          value={draft.country}
          error={errors.country}
          onChange={(event) => set("country", event.target.value)}
        />
        <Select
          label="Where they came from"
          value={draft.source}
          onChange={(event) => set("source", event.target.value as LeadSource)}
          options={LEAD_SOURCES.map((source) => ({
            value: source,
            label: LEAD_SOURCE_LABEL[source],
          }))}
        />

        {canSeeMoney && (
          <>
            <Input
              label="Estimated monthly value"
              type="number"
              inputMode="numeric"
              min={0}
              icon={<span className="text-[13px]">$</span>}
              value={draft.estimatedMonthlyValue}
              error={errors.estimatedMonthlyValue}
              onChange={(event) => set("estimatedMonthlyValue", event.target.value)}
            />
            <Input
              label="Deal value"
              type="number"
              inputMode="numeric"
              min={0}
              icon={<span className="text-[13px]">$</span>}
              value={draft.dealValue}
              error={errors.dealValue}
              onChange={(event) => set("dealValue", event.target.value)}
            />
          </>
        )}
      </div>

      {/* This department's own questions — the pickup location, the insurance
          type — which the drawer had no way to show, let alone change. */}
      <DynamicFields
        definitions={fields}
        values={values}
        errors={errors}
        onChange={(key, value) => {
          setValues((current) => ({ ...current, [key]: value }));
          clearError(key);
        }}
      />

      {services.length > 0 && (
        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">Interested in</p>
          <div className="flex flex-wrap gap-1.5">
            {services.map((service) => {
              const active = draft.interestedServices.includes(service.slug);
              return (
                <button
                  key={service.slug}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    set(
                      "interestedServices",
                      active
                        ? draft.interestedServices.filter((slug) => slug !== service.slug)
                        : [...draft.interestedServices, service.slug],
                    )
                  }
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                    active
                      ? "border-brand bg-brand text-paper"
                      : "border-line bg-white text-ink/55 hover:border-ink/25",
                  )}
                >
                  {service.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canReassign && assignees.length > 0 && (
        <Select
          label="Owner"
          value={draft.ownerId}
          error={errors.ownerId}
          onChange={(event) => set("ownerId", event.target.value)}
          options={[
            ...(draft.ownerId ? [] : [{ value: "", label: "Unassigned" }]),
            ...assignees.map((member) => ({
              value: member.userId,
              label: member.jobTitle ? `${member.name} · ${member.jobTitle}` : member.name,
            })),
          ]}
        />
      )}

      <Textarea
        label="Notes"
        rows={4}
        value={draft.notes}
        error={errors.notes}
        onChange={(event) => set("notes", event.target.value)}
      />
    </form>
  );
}
