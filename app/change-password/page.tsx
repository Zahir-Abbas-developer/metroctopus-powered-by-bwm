import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { KeyRound } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { DEFAULT_LANDING, LOGIN_ROUTE } from "@/lib/routes";
import { ChangePasswordForm } from "@/components/auth/ChangePasswordForm";

export const metadata: Metadata = {
  title: "Set your password",
};

/**
 * The forced first-password change.
 *
 * Deliberately outside the (app) route group: the authenticated layout
 * redirects here while the flag is set, so a page inside that layout would
 * redirect to itself forever.
 *
 * The flag is read from the database rather than the session token. A token
 * minted before the change would still claim the password needs changing, and
 * one minted before the flag was set would claim it does not.
 */
export default async function ChangePasswordPage() {
  const session = await getCurrentUser();
  if (!session) redirect(LOGIN_ROUTE);

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { mustChangePassword: true },
  });

  // Nothing to force. Sending them on rather than showing an optional form
  // keeps this page single-purpose.
  if (!user?.mustChangePassword) redirect(DEFAULT_LANDING);

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand font-display text-sm font-extrabold text-paper">
            B
          </span>
          <span className="eyebrow text-ink/45">Building Wealth Mindset</span>
        </div>

        <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-card border border-line bg-cream">
          <KeyRound className="h-5 w-5 text-brand" />
        </div>

        <p className="eyebrow mb-3 text-brand">First sign-in</p>
        <h1 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink">
          Set your own password
        </h1>
        <p className="mt-2.5 text-sm leading-relaxed text-ink/55">
          Your account was created with a shared placeholder password. Choose
          your own before you carry on — it cannot be skipped.
        </p>

        <div className="mt-8">
          <ChangePasswordForm />
        </div>
      </div>
    </main>
  );
}
