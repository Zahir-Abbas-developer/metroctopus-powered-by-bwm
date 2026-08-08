"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";

/**
 * Registers the service worker and, once, asks to turn notifications on.
 *
 * The prompt is asked once and remembered. Browsers permanently block a site
 * that fires `Notification.requestPermission()` on load, and a member who
 * declines and is asked again every morning will block it out of irritation —
 * at which point the one genuinely time-critical alert in the product can
 * never reach them again. So: an explainer first, the browser dialog only
 * after they opt in, and silence afterwards either way.
 */

const ASKED_KEY = "agencyos:push-asked";

export function PushSetup() {
  const toast = useToast();
  const [prompt, setPrompt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;

    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // An unregistrable worker just means no push; the app is unaffected.
        return;
      }

      if (cancelled) return;

      const response = await fetch("/api/push", { cache: "no-store" }).catch(() => null);
      if (!response?.ok || cancelled) return;

      const body = (await response.json()) as {
        configured: boolean;
        publicKey: string | null;
        subscriptions: number;
      };

      if (!body.configured || !body.publicKey) return;
      setPublicKey(body.publicKey);

      const alreadyAsked = window.localStorage.getItem(ASKED_KEY) === "1";
      const permission = typeof Notification !== "undefined" ? Notification.permission : "denied";

      // Already granted but no subscription on file — a reinstall, or a
      // cleared site. Re-subscribe quietly; no need to ask again.
      if (permission === "granted" && body.subscriptions === 0) {
        await subscribe(body.publicKey).catch(() => {});
        return;
      }

      if (permission === "default" && !alreadyAsked && !cancelled) setPrompt(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    window.localStorage.setItem(ASKED_KEY, "1");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.toast("No problem — the in-app banner will still warn you.", "info");
        setPrompt(false);
        return;
      }

      await subscribe(publicKey);
      toast.success("Notifications on. You'll hear about a check the moment it fires.");
      setPrompt(false);
    } catch {
      toast.error("Couldn't turn notifications on in this browser.");
    } finally {
      setBusy(false);
    }
  }, [publicKey, toast]);

  function dismiss() {
    window.localStorage.setItem(ASKED_KEY, "1");
    setPrompt(false);
  }

  if (!prompt) return null;

  return (
    <div className="rounded-card border border-line bg-white p-4 sm:flex sm:items-center sm:gap-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-brand/20 bg-brand-tint text-brand">
        <BellRing className="h-[18px] w-[18px]" />
      </span>

      <div className="mt-3 min-w-0 flex-1 sm:mt-0">
        <p className="text-sm font-medium text-ink">Turn on notifications?</p>
        <p className="mt-0.5 text-[13px] leading-relaxed text-ink/55">
          So you never miss an availability check. They&rsquo;re random and the
          window closes — a notification is the difference between answering in
          time and losing a point.
        </p>
      </div>

      <div className="mt-3 flex items-center gap-2 sm:mt-0">
        <Button size="sm" loading={busy} onClick={() => void enable()}>
          Enable
        </Button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Not now"
          className="rounded-[9px] p-2 text-ink/35 transition-colors hover:bg-cream hover:text-ink/70"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/** VAPID keys travel as base64url; PushManager wants raw bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function subscribe(publicKey: string): Promise<void> {
  const registration = await navigator.serviceWorker.ready;

  const existing = await registration.pushManager.getSubscription();
  const subscription =
    existing ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = subscription.toJSON() as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };

  await fetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
  });
}
