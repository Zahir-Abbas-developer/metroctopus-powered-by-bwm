"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useAttendance, useTicker } from "@/components/attendance/useAttendance";
import { cn } from "@/lib/utils";

/**
 * The availability-check banner.
 *
 * Sits above every page for members, because a check is worthless if it can be
 * missed by being on the wrong screen. Amber and full-width by design — this is
 * the one interruption in the product that is meant to be unmissable.
 *
 * The countdown runs against server time corrected for device skew, so putting
 * a laptop clock back does not buy anyone extra minutes.
 */
export function AvailabilityBanner() {
  const { state, busy, respond, serverNow } = useAttendance();
  const [justPassed, setJustPassed] = useState(false);

  useTicker(1000);

  const active = state?.activeCheck ?? null;

  // Briefly hold the success state so the banner confirms rather than vanishing.
  useEffect(() => {
    if (!justPassed) return;
    const timer = setTimeout(() => setJustPassed(false), 4000);
    return () => clearTimeout(timer);
  }, [justPassed]);

  if (justPassed) {
    return (
      <div className="no-print sticky top-0 z-30 border-b border-brand/25 bg-brand-tint">
        <div className="mx-auto flex max-w-shell items-center gap-2.5 px-5 py-3 sm:px-8 lg:px-10">
          <CheckCircle2 aria-hidden className="h-4 w-4 shrink-0 text-brand" />
          <p className="text-[13px] font-medium text-brand">
            Confirmed — thanks. Logged against your attendance for today.
          </p>
        </div>
      </div>
    );
  }

  if (!active) return null;

  const remainingMs = new Date(active.windowEndsAt).getTime() - serverNow();
  const remaining = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  // The last ten minutes read as urgent rather than merely amber.
  const critical = remaining <= 600;

  return (
    <div
      role="alert"
      className={cn(
        "no-print sticky top-0 z-30 border-b",
        critical ? "border-danger/30 bg-danger-tint" : "border-warn/30 bg-warn-tint",
      )}
    >
      <div className="mx-auto flex max-w-shell flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 sm:px-8 lg:px-10">
        <ShieldAlert
          aria-hidden
          className={cn("h-4 w-4 shrink-0", critical ? "text-danger" : "text-warn")}
        />

        <div className="min-w-0 flex-1">
          <p
            className={cn(
              "text-[13px] font-medium",
              critical ? "text-danger" : "text-warn",
            )}
          >
            Availability check — confirm you&rsquo;re at work
          </p>
          <p className={cn("text-[12px]", critical ? "text-danger/75" : "text-warn/75")}>
            {remaining === 0
              ? "This window has closed."
              : `${minutes}:${String(seconds).padStart(2, "0")} left to respond`}
          </p>
        </div>

        <Button
          size="sm"
          variant={critical ? "danger" : "primary"}
          loading={busy}
          onClick={async () => {
            const result = await respond(active.id);
            if (result.ok) setJustPassed(true);
          }}
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        >
          I&rsquo;m Available
        </Button>
      </div>
    </div>
  );
}
