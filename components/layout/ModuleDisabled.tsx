import Link from "next/link";
import { PowerOff } from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClasses } from "@/components/ui/Button";
import { moduleLabel, type ModuleKey } from "@/lib/modules";

/**
 * What a parked module's route renders once its flag is off.
 *
 * Doctrine 5 wants the feature gone, not broken. Its nav entry and dashboard
 * cards are already absent, so nothing in the product links here — this exists
 * for a bookmark, a stale tab or a typed URL, and its job is to be a calm dead
 * end rather than a crash or a blank page.
 *
 * Composed from the existing EmptyState, not a new screen.
 */
export function ModuleDisabled({
  module,
  canManage = false,
}: {
  module: ModuleKey;
  /** Admins get a way to the toggle; a member would only hit a locked page. */
  canManage?: boolean;
}) {
  return (
    <EmptyState
      icon={PowerOff}
      eyebrow="Module disabled"
      title={`${moduleLabel(module)} is switched off`}
      description={
        canManage
          ? "This module is parked. Turn it on in Settings → Modules if the business starts using it."
          : "This part of the app is not in use. Ask an admin if you think it should be."
      }
      action={
        canManage ? (
          <Link href="/settings/modules" className={buttonClasses("secondary")}>
            Open module settings
          </Link>
        ) : undefined
      }
    />
  );
}
