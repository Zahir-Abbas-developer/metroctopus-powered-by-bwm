import type { Metadata } from "next";

import { TaskBoard } from "@/components/tasks/TaskBoard";

export const metadata: Metadata = {
  title: "Tasks",
};

export default function TasksPage() {
  return <TaskBoard />;
}
