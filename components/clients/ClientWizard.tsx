"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { DepartmentPicker } from "@/components/fields/DepartmentPicker";
import type { CreatableDepartment } from "@/lib/departments";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, INDUSTRIES } from "@/lib/constants";
import { addDays, formatDate, toDateInput } from "@/lib/date";
import { clientDetailsSchema, fieldErrors } from "@/lib/validation";
import { PROJECT_LENGTH_DAYS } from "@/lib/constants";
import { SERVICE_TEMPLATES, WEEKLY_REPORT_MODULE } from "@/lib/templates";
import { cn } from "@/lib/utils";
import type { ServiceSummary } from "@/lib/types";

type Step = 1 | 2 | 3;

const STEPS: { step: Step; label: string; hint: string }[] = [
  { step: 1, label: "Business", hint: "Who they are" },
  { step: 2, label: "Services", hint: "What they've bought" },
  { step: 3, label: "Engagement", hint: "Their first cycle" },
];

type Draft = {
  /** The business line the client belongs to. Required by the server. */
  departmentId: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  country: string;
  industry: string;
  monthlyBudget: string;
  status: string;
  notes: string;
  serviceIds: string[];
  projectTitle: string;
  startDate: string;
};

function emptyDraft(): Draft {
  const today = new Date();
  return {
    departmentId: "",
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    country: "",
    industry: "",
    monthlyBudget: "",
    status: "ACTIVE",
    notes: "",
    serviceIds: [],
    projectTitle: `${new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Karachi",
      month: "short",
      year: "numeric",
    }).format(today)} Retainer`,
    startDate: toDateInput(today),
  };
}

/**
 * Three steps: who they are, what they bought, and the first engagement cycle.
 *
 * Step 2 shows what each service will actually generate, so the owner picks
 * with the plan in view rather than discovering twenty-five milestones after
 * the fact.
 */
export function ClientWizard({
  open,
  services,
  convertLeadId,
  onClose,
}: {
  open: boolean;
  services: ServiceSummary[];
  /** Set when opened from a won deal — pre-fills and links back to the lead. */
  convertLeadId?: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<CreatableDepartment[] | null>(null);
  /** Bumped to send the dialog back to its top without changing step. */
  const [scrollToken, setScrollToken] = useState(0);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setDraft(emptyDraft());
    setErrors({});
    setFormError(null);
  }, [open]);

  /* The departments this person may file a client under.

     The wizard predates departments and never asked for one — while the server
     has required `departmentId` since the multi-department fork, because a
     client with no department is invisible to every department-scoped query.
     The result was a wizard that could not be completed by anyone: step 1
     failed validation on a field it did not render, so the error had nowhere
     to appear and Continue simply did nothing. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    void (async () => {
      const response = await fetch("/api/departments/creatable").catch(() => null);
      const body = response?.ok ? await response.json().catch(() => ({})) : {};
      if (cancelled) return;

      const list: CreatableDepartment[] = body?.departments ?? [];
      setDepartments(list);
      // One choice is not a choice. A converted lead brings its own department
      // and wins over this, so only an empty draft is filled.
      if (list.length === 1) {
        setDraft((current) =>
          current.departmentId ? current : { ...current, departmentId: list[0]!.id },
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * Pre-fill from a won deal.
   *
   * Deliberately a draft rather than a silent conversion: the wizard is where
   * the budget, the cycle dates and the services that will generate a month of
   * work get confirmed, and creating all of that in the background from a
   * lead nobody re-read would be a plan nobody looked at.
   */
  useEffect(() => {
    if (!open || !convertLeadId) return;
    let cancelled = false;

    void (async () => {
      const response = await fetch(`/api/leads/${convertLeadId}/convert`, {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok || cancelled) return;

      const body = (await response.json()) as {
        draft: {
          departmentId: string;
          businessName: string;
          contactName: string;
          email: string;
          phone: string;
          country: string;
          monthlyBudget: number;
          serviceIds: string[];
          notes: string;
        };
        unavailableServices: string[];
      };

      if (cancelled) return;

      setDraft((current) => ({
        ...current,
        // A won deal becomes a client of the same business line.
        departmentId: body.draft.departmentId || current.departmentId,
        businessName: body.draft.businessName,
        contactName: body.draft.contactName,
        email: body.draft.email,
        phone: body.draft.phone,
        country: body.draft.country,
        monthlyBudget: body.draft.monthlyBudget ? String(body.draft.monthlyBudget) : "",
        serviceIds: body.draft.serviceIds,
        notes: body.draft.notes,
      }));

      // A service can be retired between a lead being logged and the deal
      // closing. Say so rather than dropping it from the plan in silence.
      if (body.unavailableServices.length > 0) {
        setFormError(
          `${body.unavailableServices.join(", ")} ${
            body.unavailableServices.length === 1 ? "is" : "are"
          } no longer in the catalogue — pick a replacement.`,
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, convertLeadId]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const selectedServices = useMemo(
    () => services.filter((service) => draft.serviceIds.includes(service.id)),
    [services, draft.serviceIds],
  );

  /** What the selected services will generate, previewed before committing. */
  const preview = useMemo(() => {
    const modules = selectedServices
      .map((service) => SERVICE_TEMPLATES[service.slug])
      .filter(Boolean);
    const milestoneCount =
      modules.reduce((sum, module) => sum + module.milestones.length, 0) +
      WEEKLY_REPORT_MODULE.milestones.length;

    return { moduleCount: modules.length + 1, milestoneCount };
  }, [selectedServices]);

  function validateStep1(): boolean {
    const parsed = clientDetailsSchema.safeParse({
      departmentId: draft.departmentId,
      businessName: draft.businessName,
      contactName: draft.contactName,
      email: draft.email,
      phone: draft.phone || undefined,
      country: draft.country || undefined,
      industry: draft.industry || undefined,
      monthlyBudget: Number(draft.monthlyBudget || 0),
      status: draft.status,
      notes: draft.notes || undefined,
    });

    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      // The department and the first fields sit at the top of a long step;
      // on a phone the person is at the bottom, next to Continue.
      setScrollToken((token) => token + 1);
      return false;
    }
    setErrors({});
    return true;
  }

  function next() {
    setFormError(null);

    if (step === 1) {
      if (!validateStep1()) return;
      setStep(2);
      return;
    }

    if (step === 2) {
      if (draft.serviceIds.length === 0) {
        setFormError("Pick at least one service — it's what generates their plan.");
        return;
      }
      setStep(3);
    }
  }

  async function submit() {
    setFormError(null);
    setSaving(true);

    try {
      const response = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: draft.departmentId,
          businessName: draft.businessName,
          contactName: draft.contactName,
          email: draft.email,
          phone: draft.phone || undefined,
          country: draft.country || undefined,
          industry: draft.industry || undefined,
          monthlyBudget: Number(draft.monthlyBudget || 0),
          status: draft.status,
          notes: draft.notes || undefined,
          serviceIds: draft.serviceIds,
          projectTitle: draft.projectTitle,
          startDate: draft.startDate,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) {
          setErrors(body.fields);
          // Send them back to the step that actually holds the bad field.
          if (Object.keys(body.fields).some((key) => key in emptyDraft() && key !== "serviceIds")) {
            setStep(1);
          }
        }
        setFormError(body?.error ?? "Something went wrong. Please try again.");
        return;
      }

      onClose();
      // Land on the new project's plan, per the brief.
      // Link the lead to the client it became, so the pipeline shows the
      // provenance and the deal can't be converted twice.
      if (convertLeadId && body.client?.id) {
        await fetch(`/api/leads/${convertLeadId}/convert`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: body.client.id }),
        }).catch(() => {});
      }

      // The server picks the destination: the plan when the retainer-projects
      // module is on, otherwise the client's own page — never a page that
      // would announce a disabled module right after a successful save.
      router.push(body.next ?? `/clients/${body.client.id}`);
      router.refresh();
    } catch {
      setFormError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  const endDate = useMemo(() => {
    const start = new Date(`${draft.startDate}T00:00:00.000Z`);
    return Number.isNaN(start.getTime()) ? null : addDays(start, PROJECT_LENGTH_DAYS);
  }, [draft.startDate]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      size="lg"
      eyebrow={`Step ${step} of 3 · ${STEPS[step - 1].hint}`}
      title="Onboard a client"
      scrollKey={`${step}:${scrollToken}`}
      footer={
        <>
          {step > 1 ? (
            <Button
              variant="ghost"
              onClick={() => setStep((current) => (current - 1) as Step)}
              disabled={saving}
              icon={<ArrowLeft className="h-4 w-4" />}
            >
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          )}

          {step < 3 ? (
            <Button onClick={next}>
              Continue
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button onClick={submit} loading={saving} icon={<Check className="h-4 w-4" />}>
              Create client & plan
            </Button>
          )}
        </>
      }
    >
      <Stepper step={step} />

      {formError && (
        <div
          role="alert"
          className="mb-5 flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{formError}</span>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-[13px] font-medium text-ink/80">
              Department <span className="text-danger">*</span>
            </p>
            {departments === null ? (
              <p className="text-[13px] text-ink/45">Loading departments…</p>
            ) : (
              <DepartmentPicker
                departments={departments}
                value={draft.departmentId}
                onChange={(id) => set("departmentId", id)}
              />
            )}
            {errors.departmentId && (
              <p role="alert" className="mt-2 text-[12px] text-danger">
                {errors.departmentId}
              </p>
            )}
          </div>

          <Input
            label="Business name"
            requiredMark
            placeholder="Lumen Skincare"
            value={draft.businessName}
            onChange={(event) => set("businessName", event.target.value)}
            error={errors.businessName}
            disabled={saving}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Contact name"
              requiredMark
              placeholder="Sara Malik"
              value={draft.contactName}
              onChange={(event) => set("contactName", event.target.value)}
              error={errors.contactName}
              disabled={saving}
            />
            <Input
              label="Contact email"
              type="email"
              requiredMark
              placeholder="sara@lumenskin.co"
              value={draft.email}
              onChange={(event) => set("email", event.target.value)}
              error={errors.email}
              disabled={saving}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Phone"
              placeholder="+92 300 1234567"
              value={draft.phone}
              onChange={(event) => set("phone", event.target.value)}
              error={errors.phone}
              disabled={saving}
            />
            <Input
              label="Country"
              placeholder="Pakistan"
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
                list="industry-suggestions"
                placeholder="Beauty & Skincare"
                value={draft.industry}
                onChange={(event) => set("industry", event.target.value)}
                error={errors.industry}
                disabled={saving}
              />
              <datalist id="industry-suggestions">
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
              placeholder="4500"
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
            placeholder="Anything the team should know before they start."
            value={draft.notes}
            onChange={(event) => set("notes", event.target.value)}
            error={errors.notes}
            disabled={saving}
          />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink/60">
            Each service brings its own workstream and dated milestones. You can
            edit every one of them afterwards.
          </p>

          {/* A client cannot be onboarded without at least one service, so an
              empty catalogue makes this step a dead end. Say so, and say where
              the catalogue lives, rather than showing a blank step whose
              Continue answers only "pick at least one service". */}
          {services.length === 0 && (
            <div
              role="alert"
              className="rounded-card border border-line bg-cream p-4 text-[13px] leading-relaxed text-ink/70"
            >
              There are no services in the catalogue yet, and a client needs at
              least one. Close this, open <strong>Services</strong> at the top of
              the Clients page, add one, then onboard the client again.
            </div>
          )}

          {services.map((service) => {
            const selected = draft.serviceIds.includes(service.id);
            const template = SERVICE_TEMPLATES[service.slug];

            return (
              <button
                key={service.id}
                type="button"
                disabled={saving}
                onClick={() =>
                  set(
                    "serviceIds",
                    selected
                      ? draft.serviceIds.filter((id) => id !== service.id)
                      : [...draft.serviceIds, service.id],
                  )
                }
                className={cn(
                  "flex w-full items-start gap-3.5 rounded-card border p-4 text-left transition-colors",
                  selected
                    ? "border-brand bg-brand-tint"
                    : "border-line bg-white hover:border-ink/20",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                    selected ? "border-brand bg-brand text-paper" : "border-line bg-white",
                  )}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink">{service.name}</span>
                  {service.description && (
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-ink/55">
                      {service.description}
                    </span>
                  )}
                  <span className="mt-1.5 block text-[12px] text-ink/40">
                    {template
                      ? `Generates "${template.name}" · ${template.milestones.length} milestones`
                      : "No template yet — starts empty"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <Input
            label="Engagement title"
            requiredMark
            placeholder="Nov 2026 Retainer"
            value={draft.projectTitle}
            onChange={(event) => set("projectTitle", event.target.value)}
            error={errors.projectTitle}
            disabled={saving}
          />

          <Input
            label="Start date"
            type="date"
            requiredMark
            value={draft.startDate}
            onChange={(event) => set("startDate", event.target.value)}
            error={errors.startDate}
            disabled={saving}
            hint={
              endDate
                ? `Runs ${PROJECT_LENGTH_DAYS} days, ending ${formatDate(endDate)}.`
                : undefined
            }
          />

          <div className="rounded-card border border-line bg-cream p-4">
            <p className="eyebrow mb-3 flex items-center gap-1.5 text-brand">
              <Sparkles aria-hidden className="h-3.5 w-3.5" />
              What gets created
            </p>

            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-ink/55">Client</dt>
                <dd className="font-medium text-ink">{draft.businessName || "—"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/55">Services</dt>
                <dd className="text-right font-medium text-ink">
                  {selectedServices.map((service) => service.name).join(", ") || "—"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/55">Workstreams</dt>
                <dd className="font-medium text-ink">{preview.moduleCount}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-ink/55">Milestones</dt>
                <dd className="font-medium text-ink">{preview.milestoneCount}</dd>
              </div>
            </dl>

            <p className="mt-3 border-t border-line pt-3 text-[12px] leading-relaxed text-ink/45">
              Includes four weekly client reports, seven days apart. Delivery
              work is pre-assigned by specialism; the reports are left for you
              to assign.
            </p>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="mb-6 flex items-center gap-2">
      {STEPS.map((item, index) => {
        const done = item.step < step;
        const active = item.step === step;

        return (
          <li key={item.step} className="flex flex-1 items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-[11px] font-bold transition-colors",
                done && "bg-brand text-paper",
                active && "bg-ink text-paper",
                !done && !active && "border border-line bg-white text-ink/40",
              )}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : item.step}
            </span>

            <span
              className={cn(
                "hidden text-[13px] font-medium sm:block",
                active ? "text-ink" : "text-ink/40",
              )}
            >
              {item.label}
            </span>

            {index < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn("h-px flex-1", done ? "bg-brand" : "bg-line")}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
