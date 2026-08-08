import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";
import { IncentiveQueue } from "@/components/incentives/IncentiveQueue";

export const metadata: Metadata = { title: "Incentives" };

export default async function IncentivesPage() {
  await requireAdmin();
  return <IncentiveQueue />;
}
