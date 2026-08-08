import type { Metadata } from "next";
import { Suspense } from "react";

import { requireUser } from "@/lib/session";
import { PipelineBoard } from "@/components/pipeline/PipelineBoard";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = {
  title: "Pipeline",
};

export default async function PipelinePage() {
  // Visible to everyone. A five-person agency where only the owner knows what
  // is coming is a five-person agency that gets surprised — and members can
  // only edit the leads they own, which the API enforces.
  await requireUser();

  return (
    <Suspense fallback={<Skeleton className="h-[520px] rounded-card" />}>
      <PipelineBoard />
    </Suspense>
  );
}
