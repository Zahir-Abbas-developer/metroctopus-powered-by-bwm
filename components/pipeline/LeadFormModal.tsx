"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, type LeadSource } from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";

type Draft = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  country: string;
  source: LeadSource;
  estimatedMonthlyValue: string;
  interestedServices: string[];
  ownerId: string;
  notes: string;
};

function emptyDraft(): Draft {
  return {
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    country: "",
    source: "OUTREACH",
    estimatedMonthlyValue: "",
    interestedServices: [],
    ownerId: "",
    notes: "",
  };
}

/**
 * Adding a lead.
 *
 * The services and the monthly value are asked for here rather than at
 * conversion, because they are what the prospect was actually talked to about
 * — and because they pre-fill the onboarding wizard the moment the deal is
 * won, which is the whole reason the conversion is one click.
 */
export function LeadFormModal({
  open,
  services,
  owners,
  canAssign,
  onClose,
  onSaved,
}: {
  open: boolean;
  services: { slug: string; name: string }[];
  owners: { id: string; name: string }[];
  canAssign: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(emptyDraft());
    setErrors({});
  }, [open]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: draft.businessName,
          contactName: draft.contactName,
          email: draft.email,
          phone: draft.phone,
          country: draft.country,
          source: draft.source,
          estimatedMonthlyValue: Number(draft.estimatedMonthlyValue || 0),
          interestedServices: draft.interestedServices,
          ...(canAssign && draft.ownerId ? { ownerId: draft.ownerId } : {}),
          notes: draft.notes,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save that lead.");
        return;
      }

      toast.success(`${draft.businessName} added to the pipeline.`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Add a lead">
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Business"
            requiredMark
            autoFocus
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
            value={draft.email}
            error={errors.email}
            onChange={(event) => set("email", event.target.value)}
          />
          <Input
            label="Phone"
            value={draft.phone}
            error={errors.phone}
            onChange={(event) => set("phone", event.target.value)}
          />
          <Input
            label="Country"
            value={draft.country}
            onChange={(event) => set("country", event.target.value)}
          />
          <Input
            label="Estimated monthly value"
            type="number"
            min={0}
            icon={<span className="text-[13px]">$</span>}
            value={draft.estimatedMonthlyValue}
            error={errors.estimatedMonthlyValue}
            onChange={(event) => set("estimatedMonthlyValue", event.target.value)}
            hint="What the retainer would be worth"
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

          {canAssign && owners.length > 0 && (
            <Select
              label="Owner"
              value={draft.ownerId}
              onChange={(event) => set("ownerId", event.target.value)}
              hint="Defaults to you"
              options={[
                { value: "", label: "You" },
                ...owners.map((person) => ({ value: person.id, label: person.name })),
              ]}
            />
          )}
        </div>

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">
            Interested in
            <span className="ml-2 font-normal text-ink/45">
              pre-fills onboarding when they sign
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {services.map((service) => {
              const active = draft.interestedServices.includes(service.slug);
              return (
                <button
                  key={service.slug}
                  type="button"
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

        <Textarea
          label="Notes"
          rows={3}
          value={draft.notes}
          placeholder="Found us through the Shopify partner directory. Running Meta in-house, unhappy with ROAS."
          onChange={(event) => set("notes", event.target.value)}
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={saving}
            disabled={draft.businessName.trim().length < 2 || draft.contactName.trim().length < 2}
            onClick={() => void save()}
          >
            Add lead
          </Button>
        </div>
      </div>
    </Modal>
  );
}
