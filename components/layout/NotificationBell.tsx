"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  CheckCircle2,
  Clock3,
  FileText,
  ThumbsDown,
  TimerOff,
  UserPlus,
} from "lucide-react";

import { EmptyState } from "@/components/ui/EmptyState";
import { relativeFromNow } from "@/lib/date";
import { NOTIFICATION_TONE, type NotificationType } from "@/lib/notifications";
import { cn } from "@/lib/utils";

type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

const ICONS: Record<NotificationType, typeof Bell> = {
  TASK_ASSIGNED: UserPlus,
  DUE_TOMORROW: Clock3,
  OVERDUE: TimerOff,
  WORK_APPROVED: CheckCircle2,
  WORK_REJECTED: ThumbsDown,
  REPORT_READY: FileText,
};

const TONE_CLASSES: Record<string, string> = {
  info: "border-info/20 bg-info-tint text-info",
  warning: "border-warn/20 bg-warn-tint text-warn",
  danger: "border-danger/20 bg-danger-tint text-danger",
  success: "border-brand/20 bg-brand-tint text-brand",
  neutral: "border-line bg-cream text-ink/60",
};

/**
 * The bell and its panel.
 *
 * Polls on a slow interval rather than holding a socket open — this is an
 * internal tool for seven people, and a 60-second delay on "your work was
 * approved" costs nothing.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/notifications", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as {
        notifications: NotificationRow[];
        unread: number;
      };
      setRows(body.notifications);
      setUnread(body.unread);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Close on outside click and on Escape.
  useEffect(() => {
    if (!open) return;

    const onClick = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function markAllRead() {
    setUnread(0);
    setRows((current) => current.map((row) => ({ ...row, readAt: row.readAt ?? new Date().toISOString() })));
    await fetch("/api/notifications", { method: "POST" });
    void load();
  }

  async function openOne(row: NotificationRow) {
    setOpen(false);

    if (!row.readAt) {
      setUnread((count) => Math.max(0, count - 1));
      await fetch(`/api/notifications/${row.id}`, { method: "PATCH" });
      void load();
    }

    if (row.href) router.push(row.href);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        className="relative rounded-[10px] border border-line bg-white p-2 text-ink/60 transition-colors hover:border-ink/25 hover:text-ink"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-danger px-1 text-[10px] font-bold text-paper">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-[min(384px,calc(100vw-2rem))] animate-scale-in overflow-hidden rounded-card border border-line bg-white">
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <p className="font-display text-sm font-bold tracking-tight text-ink">
                Notifications
              </p>
              <p className="text-[12px] text-ink/45">
                {unread === 0 ? "All caught up" : `${unread} unread`}
              </p>
            </div>

            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] text-ink/55 transition-colors hover:bg-cream hover:text-ink"
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Mark all read
              </button>
            )}
          </div>

          <div className="scrollbar-thin max-h-[380px] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-8 text-center text-[13px] text-ink/40">Loading…</p>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="Nothing yet"
                description="Assignments, approvals and deadline warnings will land here."
                className="py-10"
              />
            ) : (
              <ul className="divide-y divide-line">
                {rows.map((row) => {
                  const Icon = ICONS[row.type] ?? Bell;
                  const tone = NOTIFICATION_TONE[row.type] ?? "neutral";

                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => openOne(row)}
                        className={cn(
                          "flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-cream/60",
                          !row.readAt && "bg-brand-tint/30",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border",
                            TONE_CLASSES[tone],
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-medium text-ink">
                              {row.title}
                            </span>
                            {!row.readAt && (
                              <span
                                aria-hidden
                                className="h-1.5 w-1.5 shrink-0 rounded-pill bg-brand"
                              />
                            )}
                          </span>
                          <span className="mt-0.5 line-clamp-2 block text-[12px] leading-relaxed text-ink/55">
                            {row.body}
                          </span>
                          <span className="mt-1 block text-[11px] text-ink/35">
                            {relativeFromNow(row.createdAt)}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-line bg-cream/60 px-4 py-2.5 text-center">
            <Link
              href="/my-reports"
              onClick={() => setOpen(false)}
              className="text-[12px] text-ink/55 transition-colors hover:text-ink"
            >
              View your reports
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
