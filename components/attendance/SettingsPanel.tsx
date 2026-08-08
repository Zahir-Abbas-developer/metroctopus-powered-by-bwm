"use client";

import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { formatKarachiClock } from "@/lib/attendance-time";
import { cn } from "@/lib/utils";

type SettingsShape = {
  shiftStartMinutes: number;
  shiftEndMinutes: number;
  clockInOpensMinutes: number;
  graceMinutes: number;
  absentCutoffMinutes: number;
  checksPerDay: number;
  checkWindowMinutes: number;
  checkEarliestOffsetMinutes: number;
  checkLatestMinutes: number;
  checkMinGapMinutes: number;
  penaltyLateClockIn: number;
  penaltyAbsentDay: number;
  penaltyMissedCheck: number;
  workdays: string;
  breakAllowanceMinutes: number;
  outageReportsPerMonth: number;
  outageMaxHours: number;
  reviewSlaHours: number;
};

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

/** "12:00" <-> minutes past midnight, so times are typed as times. */
function toTimeInput(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
function fromTimeInput(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function SettingsPanel() {
  const toast = useToast();
  const [draft, setDraft] = useState<SettingsShape | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const body = (await response.json()) as { settings: SettingsShape };
      setDraft(body.settings);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function set<K extends keyof SettingsShape>(key: K, value: SettingsShape[K]) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    setErrors({});

    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (body?.fields) setErrors(body.fields);
        toast.error(body?.error ?? "Couldn't save those settings.");
        return;
      }

      setDraft(body.settings);
      toast.success("Settings saved — they apply from the next clock-in.");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") return <Skeleton className="h-[520px] rounded-card" />;

  if (state === "error" || !draft) {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load settings"
          description="The configuration didn't come back. This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const selectedDays = draft.workdays
    .split(",")
    .map((day) => Number(day.trim()))
    .filter(Boolean);

  return (
    <div className="space-y-5">
      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          The working day
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          All times are Asia/Karachi. Changes apply from the next clock-in — days
          already under way keep the rules they started with.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <TimeField
            label="Shift starts"
            minutes={draft.shiftStartMinutes}
            error={errors.shiftStartMinutes}
            onChange={(value) => set("shiftStartMinutes", value)}
          />
          <TimeField
            label="Shift ends"
            minutes={draft.shiftEndMinutes}
            error={errors.shiftEndMinutes}
            onChange={(value) => set("shiftEndMinutes", value)}
          />
          <TimeField
            label="Clock-in opens"
            minutes={draft.clockInOpensMinutes}
            error={errors.clockInOpensMinutes}
            onChange={(value) => set("clockInOpensMinutes", value)}
          />
          <TimeField
            label="Clock-in closes (absent after)"
            minutes={draft.absentCutoffMinutes}
            error={errors.absentCutoffMinutes}
            hint="No clock-in by this time counts as absent."
            onChange={(value) => set("absentCutoffMinutes", value)}
          />
          <Input
            label="Grace period (minutes)"
            type="number"
            min={0}
            value={draft.graceMinutes}
            error={errors.graceMinutes}
            onChange={(event) => set("graceMinutes", Number(event.target.value))}
            hint={`Late after ${formatKarachiClock(draft.shiftStartMinutes + draft.graceMinutes)}.`}
          />
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink/80">Working days</p>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((day) => {
              const active = selectedDays.includes(day.value);
              return (
                <button
                  key={day.value}
                  type="button"
                  onClick={() => {
                    const next = active
                      ? selectedDays.filter((value) => value !== day.value)
                      : [...selectedDays, day.value].sort();
                    set("workdays", next.join(","));
                  }}
                  className={cn(
                    "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                    active
                      ? "border-brand bg-brand text-paper"
                      : "border-line bg-white text-ink/55 hover:border-ink/25",
                  )}
                >
                  {day.label}
                </button>
              );
            })}
          </div>
          {errors.workdays && (
            <p className="mt-1.5 text-[13px] text-danger">{errors.workdays}</p>
          )}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Availability checks
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          The random checks that prove someone is reachable. Times are generated
          server-side at clock-in and are never sent to the member in advance.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Input
            label="Checks per day"
            type="number"
            min={0}
            max={12}
            value={draft.checksPerDay}
            error={errors.checksPerDay}
            onChange={(event) => set("checksPerDay", Number(event.target.value))}
            hint="Fewer are placed if a late start leaves no room."
          />
          <Input
            label="Response window (minutes)"
            type="number"
            min={5}
            value={draft.checkWindowMinutes}
            error={errors.checkWindowMinutes}
            onChange={(event) => set("checkWindowMinutes", Number(event.target.value))}
          />
          <Input
            label="Earliest, after clock-in (minutes)"
            type="number"
            min={0}
            value={draft.checkEarliestOffsetMinutes}
            error={errors.checkEarliestOffsetMinutes}
            onChange={(event) =>
              set("checkEarliestOffsetMinutes", Number(event.target.value))
            }
            hint="Nobody is checked the moment they arrive."
          />
          <Input
            label="Minimum gap between checks (minutes)"
            type="number"
            min={5}
            value={draft.checkMinGapMinutes}
            error={errors.checkMinGapMinutes}
            onChange={(event) => set("checkMinGapMinutes", Number(event.target.value))}
          />
          <TimeField
            label="Latest a check may fire"
            minutes={draft.checkLatestMinutes}
            error={errors.checkLatestMinutes}
            hint={`Its window must still close by ${formatKarachiClock(draft.shiftEndMinutes)}.`}
            onChange={(value) => set("checkLatestMinutes", value)}
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Penalties
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          Points deducted from the monthly score, which starts at 100. Entered as
          positive numbers and applied as deductions.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Input
            label="Late clock-in"
            type="number"
            step={0.5}
            min={0}
            value={draft.penaltyLateClockIn}
            error={errors.penaltyLateClockIn}
            onChange={(event) => set("penaltyLateClockIn", Number(event.target.value))}
          />
          <Input
            label="Missed check"
            type="number"
            step={0.5}
            min={0}
            value={draft.penaltyMissedCheck}
            error={errors.penaltyMissedCheck}
            onChange={(event) => set("penaltyMissedCheck", Number(event.target.value))}
          />
          <Input
            label="Absent day"
            type="number"
            step={0.5}
            min={0}
            value={draft.penaltyAbsentDay}
            error={errors.penaltyAbsentDay}
            onChange={(event) => set("penaltyAbsentDay", Number(event.target.value))}
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Fairness
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          The allowances that keep the scoring honest. None of these deduct
          points — they set what counts as protected time, and how long work may
          sit in your review queue before you&rsquo;re chased about it.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Input
            label="Daily break allowance (minutes)"
            type="number"
            min={0}
            value={draft.breakAllowanceMinutes}
            error={errors.breakAllowanceMinutes}
            onChange={(event) => set("breakAllowanceMinutes", Number(event.target.value))}
            hint="Prayer and meals. Never penalized, inside or outside the allowance."
          />
          <Input
            label="Your review SLA (hours)"
            type="number"
            min={1}
            value={draft.reviewSlaHours}
            error={errors.reviewSlaHours}
            onChange={(event) => set("reviewSlaHours", Number(event.target.value))}
            hint="Submitted work older than this notifies you daily until cleared."
          />
          <Input
            label="Outage reports per member, per month"
            type="number"
            min={0}
            value={draft.outageReportsPerMonth}
            error={errors.outageReportsPerMonth}
            onChange={(event) => set("outageReportsPerMonth", Number(event.target.value))}
          />
          <Input
            label="Longest single outage (hours)"
            type="number"
            min={1}
            value={draft.outageMaxHours}
            error={errors.outageMaxHours}
            onChange={(event) => set("outageMaxHours", Number(event.target.value))}
          />
        </div>
      </Card>

      <div className="flex justify-end">
        <Button loading={saving} onClick={save} icon={<Save className="h-4 w-4" />}>
          Save settings
        </Button>
      </div>
    </div>
  );
}

function TimeField({
  label,
  minutes,
  hint,
  error,
  onChange,
}: {
  label: string;
  minutes: number;
  hint?: string;
  error?: string;
  onChange: (minutes: number) => void;
}) {
  return (
    <Input
      label={label}
      type="time"
      value={toTimeInput(minutes)}
      hint={hint}
      error={error}
      onChange={(event) => {
        const parsed = fromTimeInput(event.target.value);
        if (parsed !== null) onChange(parsed);
      }}
    />
  );
}
