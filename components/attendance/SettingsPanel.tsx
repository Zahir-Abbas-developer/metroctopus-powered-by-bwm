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
  bonusDealWon: number;
  bonusTargetMet: number;
  penaltyTargetMissed: number;
  targetMissThreshold: number;
  autoRenewEnabled: boolean;
  carryOverDueDays: number;
  bonusQualityHigh: number;
  penaltyQualityLow: number;
  defaultTargetRoas: number;
  roasAlertWeeks: number;
  paymentOverdueDays: number;
  healthWeightDelivery: number;
  healthWeightRoas: number;
  healthWeightPayment: number;
  healthWeightBlocked: number;
  leadEscalationHours: number;
  bonusThresholdScore: number;
  bonusStreakMonths: number;
  defaultBonusPercent: number;
  reviewThresholdScore: number;
  reviewWindowMonths: number;
  reviewTriggerCount: number;
  disputeWindowDays: number;
  disputeSlaHours: number;
  leaderboardVisibility: string;
  backupWarnHours: number;
  autoAssignEnabled: boolean;
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

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Business development
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          Sales work is scored on activity and outcomes rather than milestones —
          into the same ledger, so a score means the same thing however it was
          earned.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Input
            label="Points for a deal won"
            type="number"
            step={0.5}
            min={0}
            value={draft.bonusDealWon}
            error={errors.bonusDealWon}
            onChange={(event) => set("bonusDealWon", Number(event.target.value))}
          />
          <Input
            label="Points for a weekly target met"
            type="number"
            step={0.5}
            min={0}
            value={draft.bonusTargetMet}
            error={errors.bonusTargetMet}
            onChange={(event) => set("bonusTargetMet", Number(event.target.value))}
          />
          <Input
            label="Points off for a target missed"
            type="number"
            step={0.5}
            min={0}
            value={draft.penaltyTargetMissed}
            error={errors.penaltyTargetMissed}
            onChange={(event) => set("penaltyTargetMissed", Number(event.target.value))}
          />
          <Input
            label="Miss threshold (%)"
            type="number"
            min={0}
            max={100}
            value={Math.round(draft.targetMissThreshold * 100)}
            error={errors.targetMissThreshold}
            onChange={(event) =>
              set("targetMissThreshold", Math.min(1, Number(event.target.value) / 100))
            }
            hint="A week only costs a point below this share of the target — a near miss after real work isn't a failure."
          />
        </div>
      </Card>


      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Automatic routing
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          A lead or task filed without an assignee goes to the person in that
          department whose skills or job title name the work &mdash; a Shopify job
          to the Shopify developer. With nothing matching, it goes to whoever is
          carrying the least. Anyone picked by hand always wins.
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-card border border-line p-4">
          <input
            type="checkbox"
            checked={draft.autoAssignEnabled}
            onChange={(event) => set("autoAssignEnabled", event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">
              Route unassigned work automatically
            </span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink/55">
              Off means an unassigned record stays with whoever created it, which
              is how work ends up parked on the person who answered the phone.
            </span>
          </span>
        </label>
      </Card>
      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Auto-renewal
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          Overnight, every active client whose cycle has ended gets next
          month&rsquo;s plan — same structure, same assignees, shifted dates.
          Individual clients can still opt out.
        </p>

        <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-card border border-line p-4">
          <input
            type="checkbox"
            checked={draft.autoRenewEnabled}
            onChange={(event) => set("autoRenewEnabled", event.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 accent-brand"
          />
          <span className="min-w-0">
            <span className="block text-[13px] font-medium text-ink">
              Renew retainer cycles automatically
            </span>
            <span className="mt-0.5 block text-[13px] leading-relaxed text-ink/55">
              Off means every cycle is opened by hand, for every client.
            </span>
          </span>
        </label>

        <div className="mt-4 max-w-[280px]">
          <Input
            label="Carried-over work is due after (days)"
            type="number"
            min={0}
            max={28}
            value={draft.carryOverDueDays}
            error={errors.carryOverDueDays}
            onChange={(event) => set("carryOverDueDays", Number(event.target.value))}
            hint="Days into the new cycle. Dating it to day one guarantees it's late again immediately."
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Quality and money
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          Quality amounts are deliberately smaller than a missed deadline —
          lateness is objective, a star rating is one person&rsquo;s judgement on
          one afternoon. Three and four stars move nothing.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Input
            label="Points for five-star work"
            type="number"
            step={0.5}
            min={0}
            value={draft.bonusQualityHigh}
            error={errors.bonusQualityHigh}
            onChange={(event) => set("bonusQualityHigh", Number(event.target.value))}
          />
          <Input
            label="Points off for one or two stars"
            type="number"
            step={0.5}
            min={0}
            value={draft.penaltyQualityLow}
            error={errors.penaltyQualityLow}
            onChange={(event) => set("penaltyQualityLow", Number(event.target.value))}
          />
          <Input
            label="Default ROAS target"
            type="number"
            step={0.1}
            min={0}
            value={draft.defaultTargetRoas}
            error={errors.defaultTargetRoas}
            onChange={(event) => set("defaultTargetRoas", Number(event.target.value))}
            hint="Used when a client has none of their own."
          />
          <Input
            label="Weeks under target before alerting"
            type="number"
            min={1}
            value={draft.roasAlertWeeks}
            error={errors.roasAlertWeeks}
            onChange={(event) => set("roasAlertWeeks", Number(event.target.value))}
            hint="One bad week is noise. An alert that fires on noise gets muted."
          />
          <Input
            label="Days before an invoice is overdue"
            type="number"
            min={0}
            value={draft.paymentOverdueDays}
            error={errors.paymentOverdueDays}
            onChange={(event) => set("paymentOverdueDays", Number(event.target.value))}
            hint="Measured from the cycle's start — retainers are billed up front."
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Client health weighting
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          What the health score is made of. These are relative — they don&rsquo;t
          have to add to 100, and a dimension with no data is dropped and its
          weight shared across the rest.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label="Delivery"
            type="number"
            min={0}
            max={100}
            value={draft.healthWeightDelivery}
            error={errors.healthWeightDelivery}
            onChange={(event) => set("healthWeightDelivery", Number(event.target.value))}
          />
          <Input
            label="Performance"
            type="number"
            min={0}
            max={100}
            value={draft.healthWeightRoas}
            error={errors.healthWeightRoas}
            onChange={(event) => set("healthWeightRoas", Number(event.target.value))}
          />
          <Input
            label="Payment"
            type="number"
            min={0}
            max={100}
            value={draft.healthWeightPayment}
            error={errors.healthWeightPayment}
            onChange={(event) => set("healthWeightPayment", Number(event.target.value))}
          />
          <Input
            label="Responsiveness"
            type="number"
            min={0}
            max={100}
            value={draft.healthWeightBlocked}
            error={errors.healthWeightBlocked}
            onChange={(event) => set("healthWeightBlocked", Number(event.target.value))}
          />
        </div>

        <p className="mt-3 text-[12px] text-ink/45">
          Currently{" "}
          {draft.healthWeightDelivery +
            draft.healthWeightRoas +
            draft.healthWeightPayment +
            draft.healthWeightBlocked}
          {" "}across four dimensions.
        </p>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Incentives
        </h2>
        <p className="mt-0.5 text-[13px] text-ink/50">
          Evaluated when a month closes. Members see their streak progress; the
          review rule is stated on the scoring page but never counted down at
          anyone.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Input
            label="Bonus threshold score"
            type="number"
            min={0}
            max={100}
            value={draft.bonusThresholdScore}
            error={errors.bonusThresholdScore}
            onChange={(event) => set("bonusThresholdScore", Number(event.target.value))}
          />
          <Input
            label="Consecutive months"
            type="number"
            min={1}
            value={draft.bonusStreakMonths}
            error={errors.bonusStreakMonths}
            onChange={(event) => set("bonusStreakMonths", Number(event.target.value))}
          />
          <Input
            label="Standing bonus (%)"
            type="number"
            min={0}
            max={100}
            value={draft.defaultBonusPercent}
            error={errors.defaultBonusPercent}
            onChange={(event) => set("defaultBonusPercent", Number(event.target.value))}
            hint="Payroll reference only."
          />
          <Input
            label="Review threshold score"
            type="number"
            min={0}
            max={100}
            value={draft.reviewThresholdScore}
            error={errors.reviewThresholdScore}
            onChange={(event) => set("reviewThresholdScore", Number(event.target.value))}
          />
          <Input
            label="Months to look back"
            type="number"
            min={1}
            value={draft.reviewWindowMonths}
            error={errors.reviewWindowMonths}
            onChange={(event) => set("reviewWindowMonths", Number(event.target.value))}
          />
          <Input
            label="Low months to trigger"
            type="number"
            min={1}
            value={draft.reviewTriggerCount}
            error={errors.reviewTriggerCount}
            onChange={(event) => set("reviewTriggerCount", Number(event.target.value))}
          />
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-bold tracking-tight text-ink">
          Delegation, disputes and culture
        </h2>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          <Input
            label="Lead escalation (hours)"
            type="number"
            min={1}
            value={draft.leadEscalationHours}
            error={errors.leadEscalationHours}
            onChange={(event) => set("leadEscalationHours", Number(event.target.value))}
            hint="After this, the owner is added to the queue as well as the lead."
          />
          <Input
            label="Dispute window (days)"
            type="number"
            min={1}
            value={draft.disputeWindowDays}
            error={errors.disputeWindowDays}
            onChange={(event) => set("disputeWindowDays", Number(event.target.value))}
          />
          <Input
            label="Dispute SLA (hours)"
            type="number"
            min={1}
            value={draft.disputeSlaHours}
            error={errors.disputeSlaHours}
            onChange={(event) => set("disputeSlaHours", Number(event.target.value))}
          />
          <Input
            label="Backup warning (hours)"
            type="number"
            min={1}
            value={draft.backupWarnHours}
            error={errors.backupWarnHours}
            onChange={(event) => set("backupWarnHours", Number(event.target.value))}
          />
        </div>

        <div className="mt-5">
          <p className="mb-2 text-[13px] font-medium text-ink/80">Leaderboard</p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { value: "ADMIN_ONLY", label: "Owner only" },
              { value: "TEAM_VISIBLE", label: "Whole team" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set("leaderboardVisibility", option.value)}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                  draft.leaderboardVisibility === option.value
                    ? "border-brand bg-brand text-paper"
                    : "border-line bg-white text-ink/55 hover:border-ink/25",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-ink/45">
            Owner only is the default. Ranking five people against each other
            makes fourth place feel like failure when fourth of five at 88 is a
            good month — members see their own numbers and their own trend
            instead.
          </p>
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
