import type { ReactNode } from "react";

import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { AppShell } from "@/components/layout/AppShell";
import { unseenErrorCount } from "@/lib/system-errors";
import { hasAdminPower } from "@/lib/constants";
import { getModuleFlags, hiddenNavKeys } from "@/lib/modules";

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

  // A seeded placeholder credential must not survive first contact with a real
  // user, so this gate comes before any app surface renders. Read from the
  // database, not the session: a token minted before the change would keep
  // claiming the password still needs changing.
  const account = await prisma.user.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true },
  });
  if (account?.mustChangePassword) redirect("/change-password");

  // Only the owner has the error log, so only the owner pays for the count.
  const errorBadge = hasAdminPower(user.role) ? await unseenErrorCount() : 0;
  // Resolved here rather than in the rail: the nav is a client component, and
  // a parked module must never flicker into view while a fetch resolves.
  const flags = await getModuleFlags();

  return (
    <AppShell
      errorBadge={errorBadge}
      hiddenNavKeys={hiddenNavKeys(flags)}
      attendanceEnabled={flags.attendance}
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
