import type { Metadata } from "next";
import { ShieldCheck } from "lucide-react";

import { requireAdmin } from "@/lib/session";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { markErrorsSeen, recentErrors } from "@/lib/system-errors";
import { ErrorLogList } from "@/components/admin/ErrorLogList";

export const metadata: Metadata = { title: "Error log" };

/**
 * Every page that has blown up, newest first.
 *
 * Opening this page marks everything seen, which is what clears the sidebar
 * badge — the badge counts what has arrived since the owner last looked, not
 * what is unresolved. Rows are never deleted here; an error that stops
 * happening is still evidence about what changed.
 */
export default async function ErrorsPage() {
  // Middleware blocks members from /admin; this is the server-side backstop.
  await requireAdmin();

  const errors = await recentErrors(100);
  // Read first, then mark — otherwise this render would clear its own badge
  // before the list it is about has been fetched.
  await markErrorsSeen();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Reliability"
        title="Error log"
        description="Pages and endpoints that failed, captured where they happened. The last 100, newest first."
      />

      {errors.length === 0 ? (
        <div className="rounded-card border border-line bg-white">
          <EmptyState
            icon={ShieldCheck}
            eyebrow="Nothing to report"
            title="No errors logged"
            description="Every page has rendered cleanly since this log started. New failures appear here automatically, with a badge in the sidebar."
          />
        </div>
      ) : (
        <ErrorLogList
          errors={errors.map((row) => ({
            id: row.id,
            route: row.route,
            message: row.message,
            stack: row.stack,
            digest: row.digest,
            userRole: row.userRole,
            createdAt: row.createdAt.toISOString(),
          }))}
        />
      )}
    </div>
  );
}
