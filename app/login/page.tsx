import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/session";
import { DEFAULT_LANDING } from "@/lib/routes";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: { callbackUrl?: string };
}) {
  const user = await getCurrentUser();
  if (user) redirect(DEFAULT_LANDING);

  // Only ever follow a relative callback, so the login form can't be turned
  // into an open redirect via a crafted link.
  const requested = searchParams.callbackUrl ?? "";
  const callbackUrl =
    requested.startsWith("/") && !requested.startsWith("//")
      ? requested
      : DEFAULT_LANDING;

  return (
    <main className="flex min-h-screen flex-col lg:flex-row">
      {/* Left — dark editorial panel with the radial green glow */}
      <section className="surface-dark flex min-h-[38vh] flex-col justify-between overflow-hidden px-7 py-10 sm:px-12 lg:min-h-screen lg:w-[46%] lg:px-14 lg:py-14">
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand font-display text-sm font-extrabold text-paper">
              A
            </span>
            <span className="eyebrow text-paper/50">Internal platform</span>
          </div>
        </div>

        <div className="relative mt-10 lg:mt-0">
          <h1 className="font-display text-[42px] font-extrabold leading-[0.95] tracking-[-0.035em] text-paper sm:text-[58px] lg:text-[64px]">
            AGENCY
            <br />
            OS
          </h1>
          <p className="mt-6 max-w-sm text-[15px] leading-relaxed text-paper/55">
            Every client, milestone and deadline in one place — so the work
            starts without anyone being chased for it.
          </p>
        </div>

        <div className="relative mt-10 hidden lg:block">
          <div className="h-px w-full bg-paper/10" />
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
            {["Shopify", "Google Ads", "Meta Ads", "Creative", "Funnels"].map(
              (service) => (
                <span key={service} className="eyebrow text-paper/35">
                  {service}
                </span>
              ),
            )}
          </div>
        </div>
      </section>

      {/* Right — the form on warm white */}
      <section className="flex flex-1 items-center justify-center bg-paper px-6 py-12 sm:px-10 lg:py-14">
        <div className="w-full max-w-[380px]">
          <p className="eyebrow mb-3 text-brand">Welcome back</p>
          <h2 className="font-display text-[28px] font-extrabold leading-tight tracking-[-0.02em] text-ink">
            Sign in to your workspace
          </h2>
          <p className="mt-2.5 text-sm leading-relaxed text-ink/55">
            Use the credentials issued by the agency owner.
          </p>

          <div className="mt-8">
            <LoginForm callbackUrl={callbackUrl} />
          </div>

          {process.env.NODE_ENV !== "production" && (
            <div className="mt-8 rounded-card border border-line bg-cream px-4 py-3.5">
              <p className="eyebrow mb-2 text-ink/40">Demo accounts</p>
              <dl className="space-y-1 text-[13px] text-ink/60">
                <div className="flex justify-between gap-3">
                  <dt>admin@agency.local</dt>
                  <dd className="font-medium text-ink/80">admin123</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>ayesha@agency.local</dt>
                  <dd className="font-medium text-ink/80">member123</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
