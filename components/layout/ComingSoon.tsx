import type { ComponentType } from "react";
import Link from "next/link";

import { buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Placeholder for routes that land in Phases 2–6. The nav links to them from
 * day one, so they get a designed holding screen rather than a 404.
 */
export function ComingSoon({
  eyebrow,
  title,
  description,
  phase,
  icon,
  bullets,
}: {
  eyebrow: string;
  title: string;
  description: string;
  phase: string;
  icon: ComponentType<{ className?: string }>;
  bullets: string[];
}) {
  return (
    <div className="space-y-8">
      <PageHeader eyebrow={eyebrow} title={title} description={description} />

      <Card padded={false}>
        <EmptyState
          icon={icon}
          eyebrow={phase}
          title="Not built yet"
          description="This is part of the next phase of Metroctopus. The foundation it needs — accounts, roles and the design system — is already in place."
          action={
            <Link href="/dashboard" className={buttonClasses("secondary", "md")}>
              Back to dashboard
            </Link>
          }
        />
      </Card>

      <Card surface="cream">
        <p className="eyebrow mb-3 text-ink/40">What lands here</p>
        <ul className="space-y-2.5">
          {bullets.map((bullet) => (
            <li key={bullet} className="flex items-start gap-3 text-sm text-ink/70">
              <span
                aria-hidden
                className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-pill bg-brand"
              />
              {bullet}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
