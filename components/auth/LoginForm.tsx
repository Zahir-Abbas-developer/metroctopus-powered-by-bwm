"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle, ArrowRight, Lock, Mail } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { THROTTLED_ERROR } from "@/lib/constants";

/**
 * What went wrong, in words that tell the person what to do next.
 *
 * Two outcomes, not one. "Wrong password" and "too many attempts" both used to
 * render as "those credentials didn't work", so somebody holding the correct
 * password had no way to learn that the only problem was the clock — they just
 * retyped it, which spent another attempt, which extended the wait.
 *
 * The credentials case stays deliberately vague: the server genuinely cannot
 * say whether the account exists, is deactivated, or the password was wrong,
 * and guessing on its behalf would turn the form into a way to find out who
 * works here.
 */
function messageFor(error: string): string {
  if (!error.startsWith(THROTTLED_ERROR)) {
    return "Those credentials didn't work. Check them and try again.";
  }

  const seconds = Number(error.split(":")[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Too many sign-in attempts. Wait a few minutes and try again.";
  }

  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1
    ? "Too many sign-in attempts. Try again in about a minute."
    : `Too many sign-in attempts. Try again in about ${minutes} minutes.`;
}

export function LoginForm({ callbackUrl }: { callbackUrl: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password) {
      setError("Enter both your email and password.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });

      if (!result || result.error) {
        setError(messageFor(result?.error ?? ""));
        return;
      }

      router.push(callbackUrl);
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

      <Input
        label="Email"
        type="email"
        name="email"
        autoComplete="email"
        placeholder="you@bwm.local"
        icon={<Mail className="h-4 w-4" />}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        disabled={submitting}
        required
      />

      <Input
        label="Password"
        type="password"
        name="password"
        autoComplete="current-password"
        placeholder="••••••••"
        icon={<Lock className="h-4 w-4" />}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        disabled={submitting}
        required
      />

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={submitting}
        className="mt-2"
      >
        {submitting ? "Signing in" : "Sign in"}
        {!submitting && <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  );
}
