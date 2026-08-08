"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { ErrorState } from "@/components/ui/EmptyState";
import { reportClientError } from "@/lib/report-error";

/** Route-level error boundary for every authenticated page. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    console.error(error);
    // The owner finds out from /admin/errors, not from someone mentioning it
    // in chat three days later.
    void reportClientError(pathname, error);
  }, [error, pathname]);

  return (
    <div className="rounded-card border border-line bg-white">
      <ErrorState
        title="This page didn't load"
        description="An unexpected error interrupted the page. It has been logged for the owner — try again, and if it keeps happening it will be waiting in the error log."
        onRetry={reset}
      />
    </div>
  );
}
