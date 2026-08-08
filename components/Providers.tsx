"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

/** Client-side session context, so components can call `useSession`/`signOut`. */
export function Providers({ children }: { children: ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
