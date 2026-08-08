import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";

import { requireUser } from "@/lib/session";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = {
  title: "Reports",
};

export default async function ReportsPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  return (
    <ComingSoon
      eyebrow="Performance"
      title="Reports"
      description={
        isAdmin
          ? "Weekly and monthly performance across the whole team, scored objectively."
          : "Your weekly and monthly performance, and how your score was calculated."
      }
      phase="Phases 5–6"
      icon={BarChart3}
      bullets={[
        "Everyone starts each month at 100 points",
        "Points deducted for missed deadlines and quality issues",
        "Weekly and monthly reports generated automatically",
        isAdmin
          ? "Compare the team objectively instead of by impression"
          : "See exactly why your score moved, event by event",
      ]}
    />
  );
}
