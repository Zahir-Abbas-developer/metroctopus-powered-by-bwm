import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/session";
import { SettingsTabs } from "@/components/settings/SettingsTabs";

/**
 * Settings is admin-only. Middleware already blocks /settings for members;
 * this is the server-side backstop, because an API or a page is not protected
 * by the fact that its nav entry is hidden.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  await requireAdmin();

  return (
    <div className="space-y-8">
      <SettingsTabs />
      {children}
    </div>
  );
}
