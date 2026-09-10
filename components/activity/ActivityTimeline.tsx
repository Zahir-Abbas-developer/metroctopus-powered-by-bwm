"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightLeft,
  CalendarClock,
  FileText,
  Mail,
  MessageSquare,
  Phone,
  Repeat,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime } from "@/lib/date";
import {
  ACTIVITY_TYPE_LABEL,
  LOGGABLE_ACTIVITY_TYPES,
  type ActivityType,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

type Activity = {
  id: string;
  type: string;
  note: string;
  isSystem: boolean;
  occurredAt: string;
  user: { id: string; name: string; avatarColor: string } | null;
};

const ICONS: Record<string, LucideIcon> = {
  CALL: Phone,
  EMAIL: Mail,
  MEETING: Users,
  FOLLOW_UP: CalendarClock,
  NOTE: MessageSquare,
  QUOTE: FileText,
  STATUS_CHANGE: ArrowRightLeft,
  ASSIGNMENT: Repeat,
  OTHER: MessageSquare,
  // Values from the older vocabulary. Present so historical rows still render
  // with an icon rather than falling through to a blank square.
  DM: MessageSquare,
  PROPOSAL_SENT: FileText,
};

/**
 * What has happened on this record, newest first.
 *
 * Two kinds of entry share the rail. A person logging a call is one; the app
 * recording a stage move is the other. They are marked differently and never
 * merged, because "Coach D moved this to Quote" and "Coach D says he called
 * them" are different claims and a timeline that blurs them is worth less than
 * one that says nothing.
 *
 * The quick-log bar is the icon-button row above: tap the kind, write a line,
 * save. Logging is deliberately two clicks and a sentence — anything longer
 * does not get done during a call, and a timeline nobody fills in is a feature
 * that exists only in the specification.
 */
export function ActivityTimeline({
  leadId,
  clientId,
  canLog = true,
  viewerId,
  isAdmin = false,
  onChanged,
}: {
  leadId?: string;
  clientId?: string;
  canLog?: boolean;
  /** Enables removing your own entries. Omit and no delete control renders. */
  viewerId?: string;
  isAdmin?: boolean;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const [activities, setActivities] = useState<Activity[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [filter, setFilter] = useState<string>("ALL");
  const [composing, setComposing] = useState<ActivityType | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const query = leadId ? `leadId=${leadId}` : `clientId=${clientId}`;

  const load = useCallback(async () => {
    const suffix = filter === "ALL" ? "" : `&type=${filter}`;
    const response = await fetch(`/api/activities?${query}${suffix}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      setActivities([]);
      return;
    }
    const body = await response.json().catch(() => ({}));
    setActivities(body.activities ?? []);
    setCounts(body.counts ?? {});
  }, [query, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  async function log() {
    if (!composing) return;
    setSaving(true);
    try {
      const response = await fetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(leadId ? { leadId } : { clientId }),
          type: composing,
          note,
        }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.fields?.note ?? body?.error ?? "Couldn't log that.");
        return;
      }

      setComposing(null);
      setNote("");
      toast.success(`${ACTIVITY_TYPE_LABEL[composing]} logged.`);
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const response = await fetch(`/api/activities?id=${id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't remove that.");
      return;
    }
    await load();
    onChanged?.();
  }

  // Only offer a filter for kinds this record actually has — chips for types
  // that would return nothing are noise dressed as choice.
  const present = Object.keys(counts).filter((type) => (counts[type] ?? 0) > 0);

  return (
    <Card>
      <CardHeader
        title="Activity"
        description="Everything logged on this record, and everything the app recorded itself."
      />

      {canLog && (
        <div className="mt-4">
          <div className="flex flex-wrap gap-1.5">
            {LOGGABLE_ACTIVITY_TYPES.map((type) => {
              const Icon = ICONS[type] ?? MessageSquare;
              const active = composing === type;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setComposing(active ? null : type);
                    setNote("");
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                    active
                      ? "border-brand bg-brand text-paper"
                      : "border-line bg-white text-ink/60 hover:border-ink/25 hover:text-ink",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {ACTIVITY_TYPE_LABEL[type]}
                </button>
              );
            })}
          </div>

          {composing && (
            <div className="mt-3 space-y-3">
              <Textarea
                label={`${ACTIVITY_TYPE_LABEL[composing]} — what happened?`}
                rows={2}
                autoFocus
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Spoke to the operations manager — sending a revised quote Thursday."
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setComposing(null)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={saving}
                  disabled={note.trim().length < 3}
                  onClick={() => void log()}
                >
                  Log it
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {present.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-4">
          {["ALL", ...present].map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setFilter(type)}
              className={cn(
                "rounded-pill border px-2.5 py-1 text-[12px] transition-colors",
                filter === type
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-white text-ink/55 hover:border-ink/25 hover:text-ink",
              )}
            >
              {type === "ALL"
                ? "All"
                : (ACTIVITY_TYPE_LABEL[type as ActivityType] ?? type)}
              {type !== "ALL" && (
                <span className="ml-1.5 text-[11px] text-ink/35">{counts[type]}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-5">
        {activities === null ? (
          <div className="space-y-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : activities.length === 0 ? (
          <EmptyState
            title={filter === "ALL" ? "Nothing logged yet" : "Nothing of that kind"}
            description={
              filter === "ALL"
                ? "Log a call or a note above and it appears here."
                : "Try another kind, or clear the filter."
            }
          />
        ) : (
          <ol className="relative space-y-4 border-l border-line pl-5">
            {activities.map((activity) => {
              const Icon = ICONS[activity.type] ?? MessageSquare;
              return (
                <li key={activity.id} className="relative">
                  {/* The rail marker. A system entry is hollow, a logged one is
                      filled — the difference is visible before you read it. */}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full border",
                      activity.isSystem
                        ? "border-line bg-paper text-ink/35"
                        : "border-brand bg-brand-tint text-brand",
                    )}
                  >
                    <Icon className="h-2.5 w-2.5" />
                  </span>

                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">
                      {ACTIVITY_TYPE_LABEL[activity.type as ActivityType] ?? activity.type}
                    </span>
                    {/* Automatic entries have no delete: they record what the
                        app did, and a removable record is a draft. */}
                    {!activity.isSystem &&
                      viewerId &&
                      (isAdmin || activity.user?.id === viewerId) && (
                        <button
                          type="button"
                          aria-label="Remove this entry"
                          onClick={() => void remove(activity.id)}
                          className="order-last rounded p-1 text-ink/20 transition-colors hover:text-danger"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    {activity.isSystem && (
                      <Badge size="sm" tone="neutral">
                        Automatic
                      </Badge>
                    )}
                    <span className="text-[12px] text-ink/40">
                      {formatDateTime(activity.occurredAt)}
                    </span>
                  </div>

                  <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink/70">
                    {activity.note}
                  </p>

                  {activity.user && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <Avatar
                        name={activity.user.name}
                        color={activity.user.avatarColor}
                        size="sm"
                      />
                      <span className="text-[12px] text-ink/45">{activity.user.name}</span>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Card>
  );
}
