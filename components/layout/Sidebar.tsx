"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import {
  BarChart3,
  Briefcase,
  CheckSquare,
  FileText,
  Gauge,
  KanbanSquare,
  Layers,
  LayoutDashboard,
  LogOut,
  Users2,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { navItemsForRole, type NavKey } from "@/lib/routes";
import { ROLE_LABEL, type Role } from "@/lib/constants";
import { Avatar } from "@/components/ui/Avatar";

const ICONS: Record<NavKey, LucideIcon> = {
  dashboard: LayoutDashboard,
  board: KanbanSquare,
  clients: Briefcase,
  projects: Layers,
  "my-tasks": CheckSquare,
  "my-performance": Gauge,
  "my-reports": FileText,
  team: Users2,
  reports: BarChart3,
};

export interface SidebarUser {
  name: string;
  role: Role;
  jobTitle: string;
  avatarColor: string;
}

export function Sidebar({
  user,
  onNavigate,
}: {
  user: SidebarUser;
  /** Lets the mobile drawer close itself when a link is tapped. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = navItemsForRole(user.role);

  return (
    <div className="surface-dark flex h-full w-full flex-col overflow-hidden">
      <div className="relative flex h-full flex-col">
        {/* Wordmark */}
        <div className="px-5 pb-7 pt-6">
          <Link
            href="/dashboard"
            onClick={onNavigate}
            className="flex items-center gap-2.5 rounded-[10px]"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-brand font-display text-sm font-extrabold text-paper">
              A
            </span>
            <span className="font-display text-[15px] font-extrabold tracking-[-0.01em] text-paper">
              AGENCY OS
            </span>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3">
          <p className="eyebrow mb-2 px-2 text-paper/30">Workspace</p>
          <ul className="space-y-0.5">
            {items.map((item) => {
              const Icon = ICONS[item.key];
              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors",
                      active
                        ? "bg-paper/[0.08] font-medium text-paper"
                        : "text-paper/55 hover:bg-paper/[0.05] hover:text-paper/90",
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-[18px] w-[18px] shrink-0",
                        active ? "text-brand" : "text-paper/40 group-hover:text-paper/70",
                      )}
                    />
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.comingSoon && (
                      <span className="rounded-pill border border-paper/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-paper/30">
                        Soon
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Identity + sign out */}
        <div className="mt-4 border-t border-paper/10 px-4 py-4">
          <div className="flex items-center gap-3">
            {/* The ring keeps the chip legible even against the dark rail. */}
            <Avatar
              name={user.name}
              color={user.avatarColor}
              size="md"
              className="ring-1 ring-paper/15"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-paper">
                {user.name}
              </p>
              <p className="truncate text-[11px] text-paper/45">
                {ROLE_LABEL[user.role]} · {user.jobTitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="mt-3 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] text-paper/50 transition-colors hover:bg-paper/[0.05] hover:text-paper/90"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
