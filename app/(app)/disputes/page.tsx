import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { DisputeInbox } from "@/components/disputes/DisputeInbox";

export const metadata: Metadata = { title: "Disputes" };

export default async function DisputesPage() {
  // Everyone can open this: a member sees their own, the owner sees all, a
  // service lead sees what they may rule on. The API does the scoping.
  const user = await requireUser();

  return <DisputeInbox isAdmin={user.role === "ADMIN"} />;
}
