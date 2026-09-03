import type { Metadata } from "next";
import { Suspense } from "react";

import { requireUser } from "@/lib/session";
import { BoardView } from "@/components/board/BoardView";
import { Skeleton } from "@/components/ui/Skeleton";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = {
  title: "Board",
};

export default async function BoardPage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("retainerProjects");
  if (gate) return gate;

  const user = await requireUser();

  return (
    // BoardView reads ?milestone= to deep-link a drawer, and useSearchParams
    // needs a Suspense boundary to keep the rest of the page streaming.
    <Suspense fallback={<Skeleton className="h-[520px] rounded-card" />}>
      <BoardView role={user.role} userId={user.id} />
    </Suspense>
  );
}
