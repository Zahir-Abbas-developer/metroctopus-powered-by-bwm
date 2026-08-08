import type { ReactNode } from "react";

import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/layout/AppShell";
import { unseenErrorCount } from "@/lib/system-errors";

/**
 * Every authenticated route renders inside the shell. Middleware already
 * rejects anonymous traffic; `requireUser` guarantees a user here regardless.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireUser();
  // Only the owner has the error log, so only the owner pays for the count.
  const errorBadge = user.role === "ADMIN" ? await unseenErrorCount() : 0;

  return (
    <AppShell
      errorBadge={errorBadge}
      user={{
        name: user.name ?? "Team member",
        role: user.role,
        jobTitle: user.jobTitle,
        avatarColor: user.avatarColor,
      }}
    >
      {children}
    </AppShell>
  );
}
