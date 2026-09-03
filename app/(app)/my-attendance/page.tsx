import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { MyAttendance } from "@/components/attendance/MyAttendance";
import { moduleGate } from "@/lib/module-guard";

export const metadata: Metadata = {
  title: "My attendance",
};

export default async function MyAttendancePage() {
  // Parked module: the nav entry is already gone, so this guards a
  // bookmark or a typed URL rather than a link.
  const gate = await moduleGate("attendance");
  if (gate) return gate;

  // The API scopes to the signed-in user, so a member can only ever read their
  // own month regardless of what the page asks for.
  await requireUser();

  return <MyAttendance />;
}
