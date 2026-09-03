import Link from "next/link";
import {
  Activity as ActivityIcon,
  Calendar,
  Gauge,
  MessageSquare,
  Paperclip,
  Plus,
  UserCheck,
  Workflow,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { EmptyState } from "@/components/ui/EmptyState";
import { relativeFromNow } from "@/lib/date";
import { type ActivityRow, type ActivityType } from "@/lib/activity";
import { cn } from "@/lib/utils";

const ICONS: Record<ActivityType, typeof ActivityIcon> = {
  MILESTONE_CREATED: Plus,
  STATUS_CHANGED: Workflow,
  REASSIGNED: UserCheck,
  DUE_DATE_CHANGED: Calendar,
  SCORE_EVENT: Gauge,
  COMMENT_ADDED: MessageSquare,
  ATTACHMENT_ADDED: Paperclip,
};

const TONES: Record<ActivityType, string> = {
  MILESTONE_CREATED: "border-line bg-cream text-ink/55",
  STATUS_CHANGED: "border-info/20 bg-info-tint text-info",
  REASSIGNED: "border-info/20 bg-info-tint text-info",
  DUE_DATE_CHANGED: "border-warn/20 bg-warn-tint text-warn",
  SCORE_EVENT: "border-danger/20 bg-danger-tint text-danger",
  COMMENT_ADDED: "border-line bg-cream text-ink/55",
  ATTACHMENT_ADDED: "border-line bg-cream text-ink/55",
};

/** The workspace feed — everything that happened, newest first. */
export function ActivityFeed({ activity }: { activity: ActivityRow[] }) {
  if (activity.length === 0) {
    return (
      <EmptyState
        icon={ActivityIcon}
        eyebrow="Quiet so far"
        title="No activity yet"
        description="Status changes, reassignments, comments and score events stream in here as the team works."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {activity.map((entry) => {
        const Icon = ICONS[entry.type] ?? ActivityIcon;

        return (
          <li key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
            <span
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border",
                TONES[entry.type],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>

            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-snug text-ink/75">
                {entry.actor ? (
                  <span className="inline-flex items-center gap-1.5 align-middle">
                    <Avatar
                      name={entry.actor.name}
                      color={entry.actor.avatarColor}
                      size="sm"
                      className="h-4 w-4 text-[7px]"
                    />
                    <span className="font-medium text-ink">{entry.actor.name}</span>
                  </span>
                ) : (
                  <span className="font-medium text-ink">BWM</span>
                )}{" "}
                {entry.summary}
              </p>

              {entry.detail && (
                <p className="mt-0.5 line-clamp-1 text-[12px] text-ink/45">
                  {entry.detail}
                </p>
              )}

              <p className="mt-1 text-[11px] text-ink/35">
                {entry.milestone && `${entry.milestone.clientName} · `}
                {relativeFromNow(entry.createdAt)}
              </p>
            </div>

            {entry.milestone && (
              <Link
                href={`/board?milestone=${entry.milestone.id}`}
                className="shrink-0 self-center text-[12px] text-ink/35 transition-colors hover:text-brand"
              >
                Open
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
