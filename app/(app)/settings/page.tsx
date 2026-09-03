import { redirect } from "next/navigation";

/** Settings has no landing screen of its own; departments is the first tab. */
export default function SettingsPage() {
  redirect("/settings/departments");
}
