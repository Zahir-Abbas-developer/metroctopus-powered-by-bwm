import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { MyTasks } from "@/components/tasks/MyTasks";
import { hasAdminPower } from "@/lib/constants";

export const metadata: Metadata = {
  title: "My tasks",
};

export default async function MyTasksPage() {
  const user = await requireUser();

  return <MyTasks isAdmin={hasAdminPower(user.role)} viewerId={user.id} />;
}
