"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { PROJECT_LENGTH_DAYS } from "@/lib/constants";
import { addDays, formatDate, toDateInput } from "@/lib/date";
import { SERVICE_TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { ServiceSummary } from "@/lib/types";

/** Start another cycle for a client who is already onboarded. */
export function NewEngagementModal({
  open,
  clientId,
  clientName,
  services,
  onClose,
}: {
  open: boolean;
  clientId: string;
  clientName: string;
  services: ServiceSummary[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState(() => toDateInput(new Date()));
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const today = new Date();
    setTitle(
      `${new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Karachi",
        month: "short",
        year: "numeric",
      }).format(today)} Retainer`,
    );
    setStartDate(toDateInput(today));
    setServiceIds([]);
    setErrors({});
    setFormError(null);
  }, [open]);

  async function submit() {
    setFormError(null);

    if (serviceIds.length === 0) {
      setFormError("Pick at least one service — it's what generates the plan.");
      return;
    }

    setSaving(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, title, startDate, serviceIds }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        setFormError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      onClose();
      router.push(`/projects/${body.project.id}`);
      router.refresh();
    } catch {
      setFormError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  const end = (() => {
    const start = new Date(`${startDate}T00:00:00.000Z`);
    return Number.isNaN(start.getTime()) ? null : addDays(start, PROJECT_LENGTH_DAYS);
  })();

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      eyebrow="New engagement"
      title={`Start a cycle for ${clientName}`}
      description="Pick the services this cycle covers and the plan is generated for you."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Create engagement
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
          label="Title"
          requiredMark
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={errors.title}
          disabled={saving}
        />

        <Input
          label="Start date"
          type="date"
          requiredMark
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          error={errors.startDate}
          disabled={saving}
          hint={end ? `Runs ${PROJECT_LENGTH_DAYS} days, ending ${formatDate(end)}.` : undefined}
        />

        <div>
          <p className="mb-2 text-[13px] font-medium text-ink/80">Services</p>
          <div className="space-y-2">
            {services.map((service) => {
              const selected = serviceIds.includes(service.id);
              const template = SERVICE_TEMPLATES[service.slug];

              return (
                <button
                  key={service.id}
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    setServiceIds((current) =>
                      selected
                        ? current.filter((id) => id !== service.id)
                        : [...current, service.id],
                    )
                  }
                  className={cn(
                    "flex w-full items-center gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors",
                    selected
                      ? "border-brand bg-brand-tint"
                      : "border-line bg-white hover:border-ink/20",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border",
                      selected ? "border-brand bg-brand text-paper" : "border-line bg-white",
                    )}
                  >
                    {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-ink">{service.name}</span>
                    {template && (
                      <span className="text-[12px] text-ink/40">
                        {template.milestones.length} milestones
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
