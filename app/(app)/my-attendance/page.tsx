import type { Metadata } from "next";

import { requireUser } from "@/lib/session";
import { MyAttendance } from "@/components/attendance/MyAttendance";

export const metadata: Metadata = {
  title: "My attendance",
};

export default async function MyAttendancePage() {
  // The API scopes to the signed-in user, so a member can only ever read their
  // own month regardless of what the page asks for.
  await requireUser();

  return <MyAttendance />;
}
