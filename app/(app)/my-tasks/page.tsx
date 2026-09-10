import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { MyTasks } from "@/components/tasks/MyTasks";
import { hasAdminPower } from "@/lib/constants";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = {
  title: "Milestones",
};

export default async function MyTasksPage() {
  // The milestone list belongs to the parked retainer-projects module: with
  // that module off there are no milestones to show, so this page was a
  // permanently empty "Tasks" entry in the rail. /tasks is the CRM's working
  // surface now, and this one is gated with the rest of its module.
  const gate = await moduleGate("retainerProjects");
  if (gate) return gate;

  const user = await requireUser();

  return <MyTasks isAdmin={hasAdminPower(user.role)} viewerId={user.id} />;
}
