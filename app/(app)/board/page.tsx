import type { Metadata } from "next";
import { Suspense } from "react";

import { requireUser } from "@/lib/session";
import { BoardView } from "@/components/board/BoardView";
import { Skeleton } from "@/components/ui/Skeleton";

export const metadata: Metadata = {
  title: "Board",
};

export default async function BoardPage() {
  const user = await requireUser();

  return (
    // BoardView reads ?milestone= to deep-link a drawer, and useSearchParams
    // needs a Suspense boundary to keep the rest of the page streaming.
    <Suspense fallback={<Skeleton className="h-[520px] rounded-card" />}>
      <BoardView role={user.role} userId={user.id} />
    </Suspense>
  );
}
