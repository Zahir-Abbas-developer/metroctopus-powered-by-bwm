"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { deriveWeek, weekStartOf } from "@/lib/kpi";
import type { KpiWeekRow } from "@/components/kpis/KpiPanel";

type Draft = {
  weekStart: string;
  googleSpend: string;
  metaSpend: string;
  revenue: string;
  orders: string;
  storeSessions: string;
  notes: string;
};

/**
 * Five numbers, two minutes, on a phone.
 *
 * The person with these figures is whoever ran the campaigns, and they will be
 * entering them between other things — so the form is one column, every field
 * is `inputMode="numeric"` for a number pad, and it defaults to last week
 * because that is the week you have complete data for on a Monday.
 *
 * The derived figures update live underneath. Seeing ROAS appear as you type is
 * what makes this feel like a tool rather than data entry, and it catches a
 * fat-fingered revenue before it becomes a false alert.
 */
export function KpiEntryModal({
  open,
  clientId,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  clientId: string;
  existing: KpiWeekRow | null;
  onClose: () => void;
  onSaved: (alertFired: boolean) => void;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDraft(existing ? toDraft(existing) : emptyDraft());
    setErrors({});
  }, [open, existing]);

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  const derived = useMemo(
    () =>
      deriveWeek({
        weekStart: new Date(draft.weekStart || Date.now()),
        googleSpend: num(draft.googleSpend),
        metaSpend: num(draft.metaSpend),
        revenue: num(draft.revenue),
        orders: num(draft.orders),
        storeSessions: num(draft.storeSessions),
      }),
    [draft],
  );

  async function save() {
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch(`/api/clients/${clientId}/kpis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weekStart: draft.weekStart,
          googleSpend: num(draft.googleSpend),
          metaSpend: num(draft.metaSpend),
          revenue: num(draft.revenue),
          orders: num(draft.orders),
          storeSessions: num(draft.storeSessions),
          notes: draft.notes,
        }),
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save that week.");
        return;
      }

      onSaved(Boolean(body.alertFired));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit this week" : "Log a week"}>
      <div className="space-y-4">
        <Input
          label="Week beginning"
          type="date"
          value={draft.weekStart}
          error={errors.weekStart}
          onChange={(event) => set("weekStart", event.target.value)}
          hint="Any day in the week — it snaps to the Monday."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Google Ads spend"
            inputMode="numeric"
            icon={<span className="text-[13px]">$</span>}
            value={draft.googleSpend}
            error={errors.googleSpend}
            onChange={(event) => set("googleSpend", event.target.value)}
          />
          <Input
            label="Meta spend"
            inputMode="numeric"
            icon={<span className="text-[13px]">$</span>}
            value={draft.metaSpend}
            error={errors.metaSpend}
            onChange={(event) => set("metaSpend", event.target.value)}
          />
          <Input
            label="Store revenue"
            inputMode="numeric"
            icon={<span className="text-[13px]">$</span>}
            value={draft.revenue}
            error={errors.revenue}
            onChange={(event) => set("revenue", event.target.value)}
            hint="From the store, not from the ad platforms."
          />
          <Input
            label="Orders"
            inputMode="numeric"
            value={draft.orders}
            error={errors.orders}
            onChange={(event) => set("orders", event.target.value)}
          />
          <Input
            label="Store sessions"
            inputMode="numeric"
            value={draft.storeSessions}
            error={errors.storeSessions}
            onChange={(event) => set("storeSessions", event.target.value)}
          />
        </div>

        {/* Live, because seeing ROAS appear as you type catches a fat-fingered
            revenue figure before it becomes a false performance alert. */}
        <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line sm:grid-cols-3">
          <Derived label="ROAS" value={derived.roas ?? "—"} />
          <Derived
            label="Conversion"
            value={derived.conversionRate === null ? "—" : `${derived.conversionRate}%`}
          />
          <Derived
            label="Avg order"
            value={
              derived.averageOrderValue === null
                ? "—"
                : `$${Math.round(derived.averageOrderValue).toLocaleString("en-US")}`
            }
          />
        </div>

        <Textarea
          label="Notes"
          rows={2}
          value={draft.notes}
          placeholder="Creative refresh went live Wednesday. Stock-out on the bestseller Thursday–Friday."
          onChange={(event) => set("notes", event.target.value)}
          hint="Context for whoever reads the chart in three months."
        />

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void save()}>
            {existing ? "Save changes" : "Log week"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Derived({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white px-4 py-3">
      <p className="eyebrow text-ink/40">{label}</p>
      <p className="mt-1 font-display text-lg font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

/** Defaults to last week — on a Monday that is the week you have data for. */
function emptyDraft(): Draft {
  const lastWeek = weekStartOf(new Date(Date.now() - 7 * 86_400_000));
  return {
    weekStart: lastWeek.toISOString().slice(0, 10),
    googleSpend: "",
    metaSpend: "",
    revenue: "",
    orders: "",
    storeSessions: "",
    notes: "",
  };
}

function toDraft(week: KpiWeekRow): Draft {
  return {
    weekStart: week.weekStart.slice(0, 10),
    googleSpend: String(week.googleSpend),
    metaSpend: String(week.metaSpend),
    revenue: String(week.revenue),
    orders: String(week.orders),
    storeSessions: String(week.storeSessions),
    notes: week.notes ?? "",
  };
}

function num(value: string): number {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}
