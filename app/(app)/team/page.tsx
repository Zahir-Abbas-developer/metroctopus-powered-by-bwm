import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";
import { TeamManager } from "@/components/team/TeamManager";

export const metadata: Metadata = {
  title: "Team",
};

export default async function TeamPage() {
  // Middleware blocks members from /team; this is the server-side backstop.
  const admin = await requireAdmin();

  return <TeamManager currentUserId={admin.id} />;
}
