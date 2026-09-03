import type { Metadata } from "next";

import { ModulesManager } from "@/components/settings/ModulesManager";

export const metadata: Metadata = {
  title: "Modules",
};

export default function ModulesSettingsPage() {
  return <ModulesManager />;
}
