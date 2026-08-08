import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { ReportsBrowser } from "@/components/reports/ReportsBrowser";

export const metadata: Metadata = {
  title: "My reports",
};

export default async function MyReportsPage() {
  await requireUser();

  // The API scopes to the signed-in user, so a member can only ever load their
  // own regardless of what this page asks for.
  return <ReportsBrowser isAdmin={false} />;
}
