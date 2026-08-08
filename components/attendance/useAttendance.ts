"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The member's own attendance state, polled.
 *
 * One hook shared by the dashboard card and the global banner, so the two can
 * never disagree about whether a check is live.
 *
 * Polling rather than SSE: this is five people on a 60-second cadence, and a
 * persistent connection per tab would be more moving parts than the problem
 * deserves. The poll is also what advances state server-side — see the note in
 * lib/attendance.ts — so it is doing real work, not just asking.
 *
 * `serverNow` comes back with every response and all countdowns are computed
 * against it, so a member whose device clock is wrong — or deliberately set
 * back — still sees the true remaining time.
 */

export type ActiveCheck = {
  id: string;
  scheduledAt: string;
  windowEndsAt: string;
};

export type AttendanceState = {
  serverNow: string;
  karachiMinutes: number;
  dayKind: "WORKDAY" | "OFF" | "LEAVE";
  settings: {
    shiftStartMinutes: number;
    shiftEndMinutes: number;
    clockInOpensMinutes: number;
    graceMinutes: number;
    absentCutoffMinutes: number;
    checkWindowMinutes: number;
  };
  day: {
    id: string;
    status: string;
    clockInAt: string | null;
    clockOutAt: string | null;
    totalMinutes: number | null;
    autoClosed: boolean;
  } | null;
  checks: {
    id: string;
    status: string;
    scheduledAt: string;
    windowEndsAt: string;
    respondedAt: string | null;
    responseSeconds: number | null;
  }[];
  tally: { passed: number; missed: number; cancelled: number; resolved: number };
  activeCheck: ActiveCheck | null;
};

const POLL_MS = 60_000;

export function useAttendance() {
  const [state, setState] = useState<AttendanceState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /** Offset between the server's clock and this device's, in milliseconds. */
  const skewRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/attendance/me", { cache: "no-store" });
      if (!response.ok) return;

      const body = (await response.json()) as AttendanceState;
      skewRef.current = new Date(body.serverNow).getTime() - Date.now();
      setState(body);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);

    // A backgrounded tab has its timers throttled, so refresh the moment it
    // comes back rather than showing a stale window.
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const act = useCallback(
    async (action: "CLOCK_IN" | "CLOCK_OUT") => {
      setBusy(true);
      try {
        const response = await fetch("/api/attendance/me", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const body = await response.json().catch(() => ({}));
        await load();
        return { ok: response.ok, body } as const;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const respond = useCallback(
    async (checkId: string) => {
      setBusy(true);
      try {
        const response = await fetch(`/api/attendance/checks/${checkId}/respond`, {
          method: "POST",
        });
        const body = await response.json().catch(() => ({}));
        await load();
        return { ok: response.ok, body } as const;
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  /** Server time now, corrected for this device's clock skew. */
  const serverNow = useCallback(() => Date.now() + skewRef.current, []);

  return { state, loading, busy, reload: load, act, respond, serverNow };
}

/** A ticking value, for live clocks and countdowns. */
export function useTicker(intervalMs = 1000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return tick;
}
