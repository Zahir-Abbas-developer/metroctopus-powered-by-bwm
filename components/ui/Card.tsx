import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** `cream` for inset panels, `dark` for hero-style blocks with a green glow. */
  surface?: "paper" | "cream" | "dark";
  padded?: boolean;
}

/** 1px-bordered surface. Shadows are deliberately avoided across the product. */
export function Card({
  children,
  className,
  surface = "paper",
  padded = true,
}: CardProps) {
  return (
    <div
      className={cn(
        "rounded-card border",
        surface === "paper" && "border-line bg-white",
        surface === "cream" && "border-line bg-cream",
        surface === "dark" && "surface-dark overflow-hidden border-ink",
        padded && "p-5 sm:p-6",
        className,
      )}
    >
      {surface === "dark" ? <div className="relative">{children}</div> : children}
    </div>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6",
        className,
      )}
    >
      <div className="min-w-0">
        <h3 className="font-display text-base font-bold tracking-tight text-ink">
          {title}
        </h3>
        {description && (
          <p className="mt-1 text-sm text-ink/60">{description}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("px-5 py-5 sm:px-6", className)}>{children}</div>;
}
