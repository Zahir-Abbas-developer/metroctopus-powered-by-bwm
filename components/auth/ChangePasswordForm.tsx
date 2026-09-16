"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { PasswordInput } from "@/components/auth/PasswordInput";

/**
 * The forced first-password change. Same field, button and error treatment as
 * the sign-in form — this is the second screen a new person ever sees, and it
 * should not look like a different product.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFields({});
    setSubmitting(true);

    try {
      const res = await fetch("/api/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFields(data.fields ?? {});
        setError(data.error ?? "We couldn't change your password.");
        return;
      }

      // The flag is cleared server-side; refresh so the layout stops
      // redirecting here and lets the app through.
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
        >
          <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <PasswordInput
        label="Current password"
        name="currentPassword"
        autoComplete="current-password"
        placeholder="••••••••"
        value={currentPassword}
        error={fields.currentPassword}
        onChange={(event) => setCurrentPassword(event.target.value)}
        disabled={submitting}
        required
      />

      <PasswordInput
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        placeholder="At least 10 characters"
        value={newPassword}
        error={fields.newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
        disabled={submitting}
        required
      />

      <PasswordInput
        label="Repeat new password"
        name="confirmPassword"
        autoComplete="new-password"
        placeholder="••••••••"
        value={confirmPassword}
        error={fields.confirmPassword}
        onChange={(event) => setConfirmPassword(event.target.value)}
        disabled={submitting}
        required
      />

      <Button type="submit" size="lg" fullWidth loading={submitting} className="mt-2">
        {submitting ? "Saving" : "Set my password"}
        {!submitting && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  );
}
