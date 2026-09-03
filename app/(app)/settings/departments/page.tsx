import type { Metadata } from "next";

import { DepartmentsManager } from "@/components/settings/DepartmentsManager";

export const metadata: Metadata = {
  title: "Departments",
};

export default function DepartmentsSettingsPage() {
  return <DepartmentsManager />;
}
