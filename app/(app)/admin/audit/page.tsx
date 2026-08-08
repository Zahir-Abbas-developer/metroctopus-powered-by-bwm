import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";
import { AuditLogView } from "@/components/admin/AuditLogView";

export const metadata: Metadata = { title: "Audit log" };

export default async function AuditPage() {
  // Middleware blocks members from /admin; this is the server-side backstop.
  await requireAdmin();

  return <AuditLogView />;
}
