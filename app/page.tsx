import { redirect } from "next/navigation";

import { DEFAULT_LANDING } from "@/lib/routes";

/** The root is just a doorway — middleware sends anonymous visitors to /login. */
export default function RootPage() {
  redirect(DEFAULT_LANDING);
}
