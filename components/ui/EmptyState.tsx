import type { ComponentType, ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/Button";

export interface EmptyStateProps {
  /** Any lucide icon component. */
  icon?: ComponentType<{ className?: string }>;
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
}

/**
 * The empty state is a designed screen, never a blank panel — cream medallion,
 * eyebrow, Syne title, one line of guidance and a way forward.
 */
export function EmptyState({
  icon: Icon = Inbox,
  eyebrow,
  title,
  description,
  action,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  const danger = tone === "danger";

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-16 text-center",
        className,
      )}
    >
      <div
        className={cn(
          "mb-5 flex h-14 w-14 items-center justify-center rounded-card border",
          danger ? "border-danger/20 bg-danger-tint" : "border-line bg-cream",
        )}
      >
        <Icon className={cn("h-6 w-6", danger ? "text-danger" : "text-brand")} />
      </div>

      {eyebrow && (
        <p className={cn("eyebrow mb-2", danger ? "text-danger" : "text-brand")}>
          {eyebrow}
        </p>
      )}

      <h3 className="font-display text-lg font-bold tracking-tight text-ink">
        {title}
      </h3>

      {description && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink/55">
          {description}
        </p>
      )}

      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Error counterpart to EmptyState, with a retry affordance. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Check your connection and try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <EmptyState
      icon={AlertTriangle}
      tone="danger"
      eyebrow="Error"
      title={title}
      description={description}
      className={className}
      action={
        onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : undefined
      }
    />
  );
}
