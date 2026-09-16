"use client";

import { useEffect, useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import type { TeamMember } from "@/lib/types";

type Issued = { name: string; email: string; password: string };

/**
 * Reset one person's password and hand the result over.
 *
 * Two copy buttons, and the difference matters. The password alone is for
 * pasting somewhere else; the message is for sending as-is, with the link and
 * the email address around it. Both put exactly the generated characters on
 * the clipboard — a person selecting the text by hand on a phone is how a
 * trailing space ends up in a password that then "doesn't work".
 */
export function ResetPasswordModal({
  member,
  onClose,
  onReset,
}: {
  member: TeamMember | null;
  onClose: () => void;
  onReset: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState<"password" | "message" | null>(null);

  useEffect(() => {
    if (!member) return;
    setIssued(null);
    setCopied(null);
  }, [member]);

  async function reset() {
    if (!member) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/team/${member.id}/reset-password`, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't reset that password.");
        return;
      }
      setIssued({ name: body.member.name, email: body.member.email, password: body.password });
      onReset();
    } catch {
      toast.error("We couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const message = issued
    ? [
        "Your Metroctopus login",
        `Link: ${typeof window === "undefined" ? "" : `${window.location.origin}/login`}`,
        `Email: ${issued.email}`,
        `Temporary password: ${issued.password}`,
        "You'll be asked to choose your own password after signing in.",
      ].join("\n")
    : "";

  async function copy(what: "password" | "message") {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(what === "password" ? issued.password : message);
      setCopied(what);
    } catch {
      // Clipboard access can be refused (an insecure origin, a strict browser).
      // The password is on screen either way.
      toast.error("Couldn't copy — select it and copy it by hand.");
    }
  }

  return (
    <Modal
      open={Boolean(member)}
      onClose={onClose}
      busy={busy}
      size="sm"
      eyebrow="Team"
      title={issued ? "New password ready" : "Reset password"}
      footer={
        issued ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={() => void reset()}
              loading={busy}
              icon={<KeyRound className="h-4 w-4" />}
            >
              Reset password
            </Button>
          </>
        )
      }
    >
      {member && !issued && (
        <div className="space-y-3 text-sm leading-relaxed text-ink/70">
          <p>
            <strong className="text-ink">{member.name}</strong>&rsquo;s current password stops
            working immediately, and a new temporary one is shown here once.
          </p>
          <p>They&rsquo;ll be asked to choose their own the first time they sign in with it.</p>
        </div>
      )}

      {issued && (
        <div className="space-y-4">
          <div>
            <p className="text-[13px] text-ink/55">{issued.name}</p>
            <p className="text-[13px] text-ink/55">{issued.email}</p>
          </div>

          <div className="rounded-card border border-line bg-cream px-4 py-3 text-center">
            <p className="eyebrow mb-1 text-ink/40">Temporary password</p>
            <p
              data-testid="issued-password"
              className="select-all break-all font-mono text-2xl font-semibold tracking-wide text-ink"
            >
              {issued.password}
            </p>
            <p className="mt-1 text-[12px] text-ink/45">Capital letters matter.</p>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              variant="secondary"
              fullWidth
              onClick={() => void copy("password")}
              icon={copied === "password" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            >
              {copied === "password" ? "Copied" : "Copy password"}
            </Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => void copy("message")}
              icon={copied === "message" ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            >
              {copied === "message" ? "Copied" : "Copy message to send"}
            </Button>
          </div>

          <p className="text-[12px] leading-relaxed text-ink/50">
            This is the only time it&rsquo;s shown. Send it to {issued.name.split(" ")[0]} privately.
          </p>
        </div>
      )}
    </Modal>
  );
}
