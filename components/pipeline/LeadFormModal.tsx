"use client";

import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { DepartmentPicker } from "@/components/fields/DepartmentPicker";
import { DynamicFields } from "@/components/fields/DynamicFields";
import { AssigneePicker } from "@/components/fields/AssigneePicker";
import { LEAD_SOURCES, LEAD_SOURCE_LABEL, type LeadSource } from "@/lib/pipeline-types";
import type { StageKind } from "@/lib/constants";
import type { CreatableDepartment } from "@/lib/departments";
import type { FieldDefinitionView, FieldValueMap } from "@/lib/fields";
import type { AssignableMember } from "@/lib/assignment";
import { cn } from "@/lib/utils";

type Stage = { key: string; label: string; kind: StageKind; colorToken: string | null };

type FormContext = {
  fields: FieldDefinitionView[];
  stages: Stage[];
  assignees: AssignableMember[];
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
  ownerId: string;
  stage: string;
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
    dealValue: "",
    interestedServices: [],
    ownerId: "",
    stage: "",
    notes: "",
  };
}

const STEPS = ["Department", "Details", "Stage & owner"] as const;

/**
 * Adding a lead, department first.
 *
 * The department is asked before anything else because it decides the rest of
 * the form: which questions this business line asks, which stages its pipeline
 * has, and who may be given the record. A single flat form cannot do that — it
 * would have to show every department's fields at once, which is precisely the
 * table-full-of-other-people's-nulls that the field engine exists to avoid.
 *
 * The services and the monthly value are still asked here rather than at
 * conversion, because they are what the prospect was actually talked to about
 * — and because they pre-fill the onboarding wizard the moment the deal is won.
 */
export function LeadFormModal({
  open,
  services,
  canAssign,
  onClose,
  onSaved,
}: {
  open: boolean;
  services: { slug: string; name: string }[];
  canAssign: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [values, setValues] = useState<FieldValueMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [departments, setDepartments] = useState<CreatableDepartment[] | null>(null);
  const [departmentId, setDepartmentId] = useState("");
  const [context, setContext] = useState<FormContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setDraft(emptyDraft());
    setValues({});
    setErrors({});
    setDepartmentId("");
    setContext(null);

    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/departments/creatable");
      const body = await response.json().catch(() => ({}));
      if (!cancelled) setDepartments(body?.departments ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  /**
   * Load the department's fields, stages and rankable members.
   *
   * `terms` re-ranks the assignees once the form knows what kind of work this
   * is — the Culture Plus category, for instance — so the ordering on step 3
   * reflects answers given on step 2.
   */
  const loadContext = useCallback(
    async (id: string, terms: string[] = []) => {
      setLoadingContext(true);
      try {
        const query = new URLSearchParams({ entity: "LEAD" });
        if (terms.length > 0) query.set("context", terms.join(","));

        const response = await fetch(`/api/departments/${id}/form?${query}`);
        const body = await response.json().catch(() => ({}));

        if (!response.ok) {
          toast.error(body?.error ?? "Couldn't load that department.");
          return null;
        }

        const next: FormContext = {
          fields: body.fields ?? [],
          stages: body.stages ?? [],
          assignees: body.assignees ?? [],
        };
        setContext(next);
        return next;
      } finally {
        setLoadingContext(false);
      }
    },
    [toast],
  );

  async function chooseDepartment(id: string) {
    setDepartmentId(id);
    setValues({});
    setErrors({});
    const next = await loadContext(id);
    if (!next) return;

    // Open at the first non-terminal stage this department actually has.
    const opening = next.stages.find((stage) => stage.kind === "OPEN");
    setDraft((current) => ({ ...current, stage: opening?.key ?? next.stages[0]?.key ?? "" }));
    setStep(1);
  }

  async function toStageStep() {
    // Free-text answers describe the work; they are what the ranking matches
    // member skills against.
    const terms = Object.values(values).filter(Boolean).slice(0, 12);
    await loadContext(departmentId, terms);
    setStep(2);
  }

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    clearError(key);
  }

  function setField(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
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

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId,
          businessName: draft.businessName,
          contactName: draft.contactName,
          email: draft.email,
          phone: draft.phone,
          country: draft.country,
          source: draft.source,
          estimatedMonthlyValue: Number(draft.estimatedMonthlyValue || 0),
          dealValue: Number(draft.dealValue || 0),
          interestedServices: draft.interestedServices,
          ...(canAssign && draft.ownerId ? { ownerId: draft.ownerId } : {}),
          ...(draft.stage ? { stage: draft.stage } : {}),
          notes: draft.notes,
          fieldValues: values,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) {
          setErrors(body.fields);
          // Send the user back to the step that owns the problem, rather than
          // leaving them on a step where nothing looks wrong.
          const dynamicKeys = new Set((context?.fields ?? []).map((f) => f.key));
          const bad = Object.keys(body.fields);
          if (bad.some((key) => dynamicKeys.has(key) || CORE_KEYS.has(key))) setStep(1);
        }
        toast.error(body?.error ?? "Couldn't save that lead.");
        return;
      }

      toast.success(`${draft.businessName} added to the pipeline.`);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const coreReady =
    draft.businessName.trim().length >= 2 && draft.contactName.trim().length >= 2;

  return (
    <Modal open={open} onClose={onClose} title="Add a lead" size="lg">
      <div className="space-y-5">
        <StepRail step={step} />

        {step === 0 && (
          <>
            {departments === null ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="h-28" />
                <Skeleton className="h-28" />
              </div>
            ) : (
              <DepartmentPicker
                departments={departments}
                value={departmentId}
                onChange={(id) => void chooseDepartment(id)}
              />
            )}
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        )}

        {step === 1 && (
          <>
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
              <Input
                label="Deal value"
                type="number"
                min={0}
                icon={<span className="text-[13px]">$</span>}
                value={draft.dealValue}
                error={errors.dealValue}
                onChange={(event) => set("dealValue", event.target.value)}
                hint="The quote, premium or expected volume"
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
            </div>

            {/* This department's own questions. */}
            <DynamicFields
              definitions={context?.fields ?? []}
              values={values}
              errors={errors}
              onChange={setField}
            />

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
              onChange={(event) => set("notes", event.target.value)}
            />

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button
                loading={loadingContext}
                disabled={!coreReady}
                onClick={() => void toStageStep()}
              >
                Continue
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <Select
              label="Opening stage"
              value={draft.stage}
              error={errors.stage}
              onChange={(event) => set("stage", event.target.value)}
              options={(context?.stages ?? []).map((stage) => ({
                value: stage.key,
                label: stage.label,
              }))}
            />

            {canAssign ? (
              <AssigneePicker
                members={context?.assignees ?? []}
                value={draft.ownerId}
                onChange={(userId) => set("ownerId", userId)}
              />
            ) : (
              <p className="text-[13px] text-ink/55">
                This lead will be yours. Only an admin can assign it to someone else.
              </p>
            )}
            {errors.ownerId && <p className="text-[12px] text-danger">{errors.ownerId}</p>}

            <div className="flex justify-between gap-2">
              <Button variant="ghost" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button loading={saving} disabled={!coreReady} onClick={() => void save()}>
                Add lead
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Core keys whose errors belong to step 2 of the wizard. */
const CORE_KEYS = new Set([
  "businessName",
  "contactName",
  "email",
  "phone",
  "country",
  "estimatedMonthlyValue",
  "dealValue",
  "source",
  "notes",
]);

function StepRail({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((label, index) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              "eyebrow",
              index === step ? "text-brand" : index < step ? "text-ink/45" : "text-ink/25",
            )}
          >
            {label}
          </span>
          {index < STEPS.length - 1 && (
            <span aria-hidden className="h-px w-5 bg-line" />
          )}
        </div>
      ))}
    </div>
  );
}
