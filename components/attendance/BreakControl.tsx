"use client";

import { useCallback, useEffect, useState } from "react";
import { Coffee, Play, Square } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { useTicker } from "@/components/attendance/useAttendance";
import { BREAK_REASONS, BREAK_REASON_LABEL, type BreakReason } from "@/lib/fairness-windows";
import { cn } from "@/lib/utils";

type BreakState = {
  serverNow: string;
  open: { id: string; reason: string; startedAt: string } | null;
  allowance: {
    used: number;
    allowance: number;
    remaining: number;
    overBy: number;
    exceeded: boolean;
  };
  sessions: {
    id: string;
    reason: string;
    startedAt: string;
    endedAt: string | null;
    minutes: number | null;
  }[];
};

/**
 * Prayer, meals and short personal time.
 *
 * The copy matters as much as the mechanism: a member who believes a break
 * costs them points will pray at their desk with one eye on the screen, which
 * defeats the entire purpose. So the panel says plainly, every time, that
 * protected time is never penalized.
 */
export function BreakControl({ onChange }: { onChange?: () => void }) {
  const toast = useToast();
  const [state, setState] = useState<BreakState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<BreakReason>("PRAYER");

  useTicker(1000);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/attendance/break", { cache: "no-store" });
      if (!response.ok) return;
      setState((await response.json()) as BreakState);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  async function start() {
    setBusy(true);
    try {
      const response = await fetch("/api/attendance/break", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't start that break.");
        return;
      }

      toast.success("On break. No checks will fire until you're back.");
      await load();
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  async function end() {
    setBusy(true);
    try {
      const response = await fetch("/api/attendance/break", { method: "DELETE" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't end that break.");
        return;
      }

      const dropped = body.checksDropped ?? 0;
      const shifted = body.checksShifted ?? 0;
      toast.success(
        dropped > 0
          ? `Welcome back. ${dropped} check${dropped === 1 ? "" : "s"} dropped for the day — no penalty.`
          : shifted > 0
            ? `Welcome back. ${shifted} check${shifted === 1 ? "" : "s"} moved to later.`
            : "Welcome back.",
      );
      await load();
      onChange?.();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Skeleton className="h-[168px] rounded-card" />;
  if (!state) return null;

  const { allowance, open } = state;
  const openMinutes = open
    ? Math.max(0, Math.floor((Date.now() - new Date(open.startedAt).getTime()) / 60_000))
    : 0;

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Coffee className="h-4 w-4 text-ink/40" />
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              Breaks
            </h2>
            {open && (
              <Badge size="sm" tone="info" dot>
                {BREAK_REASON_LABEL[open.reason as BreakReason] ?? open.reason}
              </Badge>
            )}
          </div>

          <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
            Prayer and meal breaks are protected time — {allowance.allowance} minutes
            a day, never penalized. Checks pause while you&rsquo;re away.
          </p>
        </div>

        <div className="text-right">
          <p
            className={cn(
              "font-display text-2xl font-extrabold tabular-nums leading-none",
              allowance.exceeded ? "text-warn" : "text-ink",
            )}
          >
            {open ? openMinutes : allowance.remaining}
            <span className="ml-1 text-[13px] font-medium text-ink/40">min</span>
          </p>
          <p className="mt-1 text-[12px] text-ink/45">
            {open
              ? "on this break"
              : allowance.exceeded
                ? `${allowance.overBy} over allowance`
                : "left today"}
          </p>
        </div>
      </div>

      {open ? (
        <Button
          className="mt-5"
          fullWidth
          variant="secondary"
          loading={busy}
          icon={<Square className="h-4 w-4" />}
          onClick={() => void end()}
        >
          I&rsquo;m back
        </Button>
      ) : (
        <div className="mt-5 space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {BREAK_REASONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                className={cn(
                  "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                  reason === option
                    ? "border-brand bg-brand text-paper"
                    : "border-line bg-white text-ink/55 hover:border-ink/25",
                )}
              >
                {BREAK_REASON_LABEL[option]}
              </button>
            ))}
          </div>

          <Button
            fullWidth
            variant="secondary"
            loading={busy}
            icon={<Play className="h-4 w-4" />}
            onClick={() => void start()}
          >
            Start break
          </Button>
        </div>
      )}

      {allowance.exceeded && (
        <p className="mt-3 text-[12px] leading-relaxed text-warn">
          You&rsquo;re past the daily allowance. Nothing is deducted for it — the
          owner just sees the total.
        </p>
      )}
    </Card>
  );
}
