"use client";

import { useEffect } from "react";

import { ErrorState } from "@/components/ui/EmptyState";

/** Route-level error boundary for every authenticated page. */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="rounded-card border border-line bg-white">
      <ErrorState
        title="This page didn't load"
        description="An unexpected error interrupted the page. Try again — if it keeps happening, the server logs will have the detail."
        onRetry={reset}
      />
    </div>
  );
}
