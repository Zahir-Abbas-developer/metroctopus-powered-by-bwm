"use client";

import { SessionProvider } from "next-auth/react";
import type { ReactNode } from "react";

import { ToastProvider } from "@/components/ui/Toast";

/** Client-side session context and the toast surface every mutation reports to. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>{children}</ToastProvider>
    </SessionProvider>
  );
}
