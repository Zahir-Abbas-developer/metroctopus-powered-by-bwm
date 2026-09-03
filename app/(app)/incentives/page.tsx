import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";
import { IncentiveQueue } from "@/components/incentives/IncentiveQueue";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = { title: "Incentives" };

export default async function IncentivesPage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("scoring");
  if (gate) return gate;

  await requireAdmin();
  return <IncentiveQueue />;
}
