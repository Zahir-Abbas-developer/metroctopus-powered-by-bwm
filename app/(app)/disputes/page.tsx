import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { DisputeInbox } from "@/components/disputes/DisputeInbox";
import { hasAdminPower } from "@/lib/constants";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = { title: "Disputes" };

export default async function DisputesPage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("scoring");
  if (gate) return gate;

  // Everyone can open this: a member sees their own, the owner sees all, a
  // service lead sees what they may rule on. The API does the scoping.
  const user = await requireUser();

  return <DisputeInbox isAdmin={hasAdminPower(user.role)} />;
}
