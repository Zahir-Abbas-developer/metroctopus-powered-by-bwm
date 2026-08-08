import type { ReactNode } from "react";

import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/layout/AppShell";

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

  return (
    <AppShell
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
