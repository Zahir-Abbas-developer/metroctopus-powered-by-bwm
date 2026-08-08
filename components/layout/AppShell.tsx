"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";

import { Sidebar, type SidebarUser } from "@/components/layout/Sidebar";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { CommandPalette } from "@/components/layout/CommandPalette";
import { AvailabilityBanner } from "@/components/attendance/AvailabilityBanner";

/**
 * Fixed 240px rail on desktop; a slide-over drawer below `lg`. The drawer
 * closes on navigation so a tapped link never leaves it hanging open.
 */
export function AppShell({
  user,
  children,
}: {
  user: SidebarUser;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  return (
    <div className="min-h-screen bg-paper">
      {/* Desktop rail */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar lg:block">
        <Sidebar user={user} />
      </aside>

      {/* Mobile top bar */}
      <div className="no-print sticky top-0 z-20 flex items-center justify-between border-b border-line bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-brand font-display text-xs font-extrabold text-paper">
            A
          </span>
          <span className="font-display text-sm font-extrabold tracking-[-0.01em] text-ink">
            AGENCY OS
          </span>
        </div>
        <div className="flex items-center gap-2">
          <NotificationBell />
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            className="rounded-[10px] border border-line p-2 text-ink/70 transition-colors hover:bg-cream"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 h-full w-full cursor-default bg-ink/50 animate-fade-in"
          />
          <div className="absolute inset-y-0 left-0 w-[264px] animate-fade-in">
            <Sidebar user={user} onNavigate={() => setDrawerOpen(false)} />
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close navigation"
              className="absolute right-3 top-5 rounded-pill p-2 text-paper/50 transition-colors hover:bg-paper/10 hover:text-paper"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="lg:pl-sidebar">
        {/* Desktop top bar. Deliberately slim — it exists for the bell, and a
            heavier header would fight the editorial page headings below it. */}
        <div className="no-print sticky top-0 z-20 hidden items-center justify-end gap-2.5 border-b border-line bg-paper/90 px-10 py-3 backdrop-blur lg:flex">
          <CommandPalette />
          <NotificationBell />
        </div>

        {/* Above everything: a check is worthless if it can be missed by being
            on the wrong screen. */}
        <AvailabilityBanner />

        <main className="mx-auto w-full max-w-shell px-5 py-8 sm:px-8 sm:py-10 lg:px-10 lg:py-12">
          {children}
        </main>
      </div>
    </div>
  );
}
