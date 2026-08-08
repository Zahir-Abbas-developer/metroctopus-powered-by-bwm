import type { Metadata } from "next";
import { CheckSquare } from "lucide-react";

import { requireUser } from "@/lib/session";
import { ComingSoon } from "@/components/layout/ComingSoon";

export const metadata: Metadata = {
  title: "Tasks",
};

export default async function TasksPage() {
  const user = await requireUser();
  const isAdmin = user.role === "ADMIN";

  return (
    <ComingSoon
      eyebrow="Work"
      title={isAdmin ? "Tasks" : "My tasks"}
      description={
        isAdmin
          ? "Every task across the agency, auto-assigned to the member who owns that service."
          : "Everything assigned to you, with its deadline and current status."
      }
      phase="Phase 4"
      icon={CheckSquare}
      bullets={[
        "Tasks generated from milestones and assigned automatically",
        "No more chasing people over chat to start work",
        "Clear deadlines, statuses and submission history",
        isAdmin
          ? "A single view of who is doing what, right now"
          : "Only your own work — nothing else to wade through",
      ]}
    />
  );
}
