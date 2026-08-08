import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  /** Uppercase letter-spaced label above the title. */
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Dark hero treatment with a radial green glow, for landing screens. */
  variant?: "light" | "dark";
  children?: ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  variant = "light",
  children,
  className,
}: PageHeaderProps) {
  const dark = variant === "dark";

  return (
    <header
      className={cn(
        dark
          ? "surface-dark overflow-hidden rounded-card border border-ink"
          : "border-b border-line pb-6",
        className,
      )}
    >
      <div className={cn(dark && "relative px-6 py-8 sm:px-9 sm:py-10")}>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0 max-w-2xl">
            <p className={cn("eyebrow mb-3", dark ? "text-brand-tint/70" : "text-brand")}>
              {eyebrow}
            </p>

            <h1
              className={cn(
                "font-display font-extrabold leading-[1.08] tracking-[-0.02em]",
                dark
                  ? "text-2xl text-paper sm:text-[34px]"
                  : "text-2xl text-ink sm:text-3xl",
              )}
            >
              {title}
            </h1>

            {description && (
              <p
                className={cn(
                  "mt-3 text-[15px] leading-relaxed",
                  dark ? "text-paper/60" : "text-ink/60",
                )}
              >
                {description}
              </p>
            )}
          </div>

          {actions && <div className="flex shrink-0 items-center gap-2.5">{actions}</div>}
        </div>

        {children && <div className="mt-8">{children}</div>}
      </div>
    </header>
  );
}
