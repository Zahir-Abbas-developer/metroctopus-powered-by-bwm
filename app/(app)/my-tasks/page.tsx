import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { MyTasks } from "@/components/tasks/MyTasks";

export const metadata: Metadata = {
  title: "My tasks",
};

export default async function MyTasksPage() {
  const user = await requireUser();

  return <MyTasks isAdmin={user.role === "ADMIN"} />;
}
