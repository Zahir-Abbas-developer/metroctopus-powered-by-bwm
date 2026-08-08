"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { REPORT_TYPES, REPORT_TYPE_LABEL, type ReportType } from "@/lib/reports";
import { toDateInput } from "@/lib/date";
import { cn } from "@/lib/utils";

const DESCRIPTIONS: Record<ReportType, string> = {
  MEMBER_WEEKLY: "One per active member, for the week containing the date below.",
  MEMBER_MONTHLY: "One per active member, for that whole calendar month.",
  CLIENT_WEEKLY: "One per active client — what shipped, what's next, what's late.",
};

export function GenerateReportsModal({
  open,
  onClose,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  onGenerated: (message: string) => void;
}) {
  const [types, setTypes] = useState<ReportType[]>(["MEMBER_WEEKLY", "CLIENT_WEEKLY"]);
  const [reference, setReference] = useState(() => toDateInput(new Date()));
  const [regenerate, setRegenerate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTypes(["MEMBER_WEEKLY", "CLIENT_WEEKLY"]);
    setReference(toDateInput(new Date()));
    setRegenerate(false);
    setError(null);
  }, [open]);

  async function submit() {
    if (types.length === 0) {
      setError("Pick at least one kind of report.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ types, reference, regenerate }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error ?? "Report generation failed. Please try again.");
        return;
      }

      const created = body.memberWeekly + body.memberMonthly + body.clientWeekly;
      onGenerated(
        created === 0
          ? `Nothing new — every report for that period already exists.${body.skipped ? ` ${body.skipped} left untouched.` : ""}`
          : `Generated ${created} report${created === 1 ? "" : "s"}.${body.skipped ? ` ${body.skipped} already existed.` : ""}`,
      );
    } catch {
      setError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={saving}
      eyebrow="Reporting"
      title="Generate reports"
      description="Pick the period and what to produce. Re-running is safe — existing reports are left alone unless you say otherwise."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saving}>
            Generate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Input
          label="Any date inside the period"
          type="date"
          requiredMark
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          disabled={saving}
          hint="Weekly reports cover that Monday–Sunday; monthly covers the whole calendar month."
        />

        <div className="space-y-2">
          <p className="text-[13px] font-medium text-ink/80">What to generate</p>
          {REPORT_TYPES.map((value) => {
            const selected = types.includes(value);

            return (
              <button
                key={value}
                type="button"
                disabled={saving}
                onClick={() =>
                  setTypes((current) =>
                    selected ? current.filter((t) => t !== value) : [...current, value],
                  )
                }
                className={cn(
                  "flex w-full items-start gap-3 rounded-[10px] border px-3.5 py-3 text-left transition-colors",
                  selected ? "border-brand bg-brand-tint" : "border-line bg-white hover:border-ink/20",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border",
                    selected ? "border-brand bg-brand text-paper" : "border-line bg-white",
                  )}
                >
                  {selected && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {REPORT_TYPE_LABEL[value]}
                  </span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-ink/50">
                    {DESCRIPTIONS[value]}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <label className="flex items-start gap-2.5 rounded-[10px] border border-line bg-cream px-3.5 py-3">
          <input
            type="checkbox"
            checked={regenerate}
            onChange={(event) => setRegenerate(event.target.checked)}
            disabled={saving}
            className="mt-0.5 h-4 w-4 accent-[#1A6B3A]"
          />
          <span className="text-[13px] leading-relaxed text-ink/70">
            Overwrite reports that already exist for this period.
            <span className="mt-0.5 block text-[12px] text-ink/45">
              A report is normally a frozen record. Only do this when the period&rsquo;s
              data was corrected after the fact.
            </span>
          </span>
        </label>
      </div>
    </Modal>
  );
}
