"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, INDUSTRIES } from "@/lib/constants";
import { fieldErrors, updateClientSchema } from "@/lib/validation";
import type { ClientRecord } from "@/components/clients/ClientDetail";

export function ClientEditModal({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client: ClientRecord;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(() => toDraft(client));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(toDraft(client));
    setErrors({});
    setFormError(null);
  }, [open, client]);

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

    const parsed = updateClientSchema.safeParse({
      businessName: draft.businessName,
      contactName: draft.contactName,
      email: draft.email,
      phone: draft.phone || undefined,
      country: draft.country || undefined,
      industry: draft.industry || undefined,
      monthlyBudget: Number(draft.monthlyBudget || 0),
      status: draft.status,
      notes: draft.notes || undefined,
      autoRenew: draft.autoRenew,
      // Blank means "use the agency default", which is null — not zero.
      targetRoas: draft.targetRoas === "" ? null : Number(draft.targetRoas),
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }

    setSaving(true);
    try {
      const response = await fetch(`/api/clients/${client.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        setFormError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      onSaved();
    } catch {
      setFormError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      eyebrow="Edit client"
      title={client.businessName}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="client-edit-form" loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="client-edit-form" onSubmit={onSubmit} noValidate className="space-y-4">
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
          label="Business name"
          requiredMark
          value={draft.businessName}
          onChange={(event) => set("businessName", event.target.value)}
          error={errors.businessName}
          disabled={saving}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Contact name"
            requiredMark
            value={draft.contactName}
            onChange={(event) => set("contactName", event.target.value)}
            error={errors.contactName}
            disabled={saving}
          />
          <Input
            label="Contact email"
            type="email"
            requiredMark
            value={draft.email}
            onChange={(event) => set("email", event.target.value)}
            error={errors.email}
            disabled={saving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Phone"
            value={draft.phone}
            onChange={(event) => set("phone", event.target.value)}
            error={errors.phone}
            disabled={saving}
          />
          <Input
            label="Country"
            value={draft.country}
            onChange={(event) => set("country", event.target.value)}
            error={errors.country}
            disabled={saving}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Input
              label="Industry"
              list="industry-edit-suggestions"
              value={draft.industry}
              onChange={(event) => set("industry", event.target.value)}
              error={errors.industry}
              disabled={saving}
            />
            <datalist id="industry-edit-suggestions">
              {INDUSTRIES.map((industry) => (
                <option key={industry} value={industry} />
              ))}
            </datalist>
          </div>

          <Input
            label="Monthly budget (USD)"
            type="number"
            min={0}
            step={100}
            value={draft.monthlyBudget}
            onChange={(event) => set("monthlyBudget", event.target.value)}
            error={errors.monthlyBudget}
            disabled={saving}
          />
        </div>

        <Select
          label="Status"
          options={CLIENT_STATUSES.map((status) => ({
            value: status,
            label: CLIENT_STATUS_LABEL[status],
          }))}
          value={draft.status}
          onChange={(event) => set("status", event.target.value)}
          error={errors.status}
          disabled={saving}
        />

        <Textarea
          label="Notes"
          rows={5}
          value={draft.notes}
          onChange={(event) => set("notes", event.target.value)}
          error={errors.notes}
          disabled={saving}
          hint="Context the team should carry into the work."
        />

        <Input
          label="Target ROAS"
          type="number"
          step={0.1}
          min={0}
          value={draft.targetRoas}
          onChange={(event) => set("targetRoas", event.target.value)}
          error={errors.targetRoas}
          disabled={saving}
          hint="What their campaigns are held to. Blank uses the agency default."
        />

        {/* The escape hatch for bespoke schedules and retainers being wound
            down. On by default, because the whole point of Phase 9 is that
            the 1st of the month runs itself. */}
        <label className="flex cursor-pointer items-start gap-3 rounded-card border border-line bg-white p-4">
          <input
            type="checkbox"
            checked={draft.autoRenew}
            disabled={saving}
            onChange={(event) => set("autoRenew", event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">
              Renew this retainer automatically
            </span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink/55">
              When the cycle ends, the next month&rsquo;s plan is created
              overnight from this one — same structure, same assignees, shifted
              dates. Unfinished work carries over with a new deadline and no
              second penalty.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}

function toDraft(client: ClientRecord) {
  return {
    businessName: client.businessName,
    contactName: client.contactName,
    email: client.email,
    phone: client.phone ?? "",
    country: client.country ?? "",
    industry: client.industry ?? "",
    monthlyBudget: String(client.monthlyBudget),
    status: client.status as string,
    notes: client.notes ?? "",
    autoRenew: client.autoRenew ?? true,
    targetRoas: client.targetRoas === null || client.targetRoas === undefined ? "" : String(client.targetRoas),
  };
}
