import type { Metadata } from "next";

import { requireAdmin } from "@/lib/session";
import { AdminAttendance } from "@/components/attendance/AdminAttendance";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = {
  title: "Attendance",
};

/** Mirrors the gate in /api/attendance/dev-trigger so the UI never offers a
 *  button the server would refuse. */
function testTriggersAllowed(): boolean {
  if (process.env.ALLOW_TEST_TRIGGERS === "1") return true;
  return process.env.NODE_ENV !== "production";
}

export default async function AttendancePage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("attendance");
  if (gate) return gate;

  // Middleware blocks members from /attendance; this is the server-side backstop.
  await requireAdmin();

  return <AdminAttendance testTriggersEnabled={testTriggersAllowed()} />;
}
