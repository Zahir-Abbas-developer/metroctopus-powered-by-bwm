"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, Phone, Trash2 } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";
import { formatDateTime, formatDate } from "@/lib/date";
import {
  ACTIVITY_LABEL,
  ACTIVITY_TYPES,
  LEAD_SOURCE_LABEL,
  LOST_REASON_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  formatMoney,
  type ActivityType,
  type LeadSource,
  type LeadStage,
  type LostReason,
} from "@/lib/pipeline-types";
import { cn } from "@/lib/utils";

type Detail = {
  lead: {
    id: string;
    businessName: string;
    contactName: string;
    email: string | null;
    phone: string | null;
    source: string;
    country: string | null;
    interestedServices: string[];
    estimatedMonthlyValue: number;
    stage: LeadStage;
    stageChangedAt: string;
    lostReason: string | null;
    lostNote: string | null;
    notes: string | null;
    createdAt: string;
    convertedAt: string | null;
    owner: { id: string; name: string; avatarColor: string; jobTitle: string } | null;
    convertedClient: { id: string; businessName: string } | null;
    activities: {
      id: string;
      type: string;
      note: string;
      occurredAt: string;
      user: { id: string; name: string; avatarColor: string };
    }[];
  };
  canEdit: boolean;
};

/**
 * One deal, and everything that has been done about it.
 *
 * The quick-log row is the point of the drawer: logging a call has to be a
 * two-tap job or it doesn't get logged, and activity that doesn't get logged
 * makes the targets — and therefore the BD score — a fiction.
 */
export function LeadDrawer({
  leadId,
  onClose,
  onChanged,
}: {
  leadId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [type, setType] = useState<ActivityType>("CALL");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!leadId) return;
    setState("loading");
    try {
      const response = await fetch(`/api/leads/${leadId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Detail);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [leadId]);

  useEffect(() => {
    if (!leadId) {
      setData(null);
      return;
    }
    void load();
  }, [leadId, load]);

  async function log() {
    if (!leadId) return;
    setBusy(true);

    try {
      const response = await fetch(`/api/leads/${leadId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, note }),
      });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't log that.");
        return;
      }

      toast.success(
        body.stageAdvanced
          ? `Logged — moved to ${STAGE_LABEL[body.stage as LeadStage]}.`
          : "Logged.",
      );
      setNote("");
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function removeActivity(activityId: string) {
    if (!leadId) return;
    const response = await fetch(`/api/leads/${leadId}/activities`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activityId }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toast.error(body?.error ?? "Couldn't remove that.");
      return;
    }

    await load();
    onChanged();
  }

  async function convert() {
    if (!leadId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/leads/${leadId}/convert`, { cache: "no-store" });
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        toast.error(body?.error ?? "Couldn't start the conversion.");
        return;
      }

      // The wizard reads the draft from the URL and pre-fills itself.
      router.push(`/clients?convert=${leadId}`);
    } finally {
      setBusy(false);
    }
  }

  const lead = data?.lead;
  const closed = lead?.stage === "WON" || lead?.stage === "LOST";

  return (
    <Drawer
      open={Boolean(leadId)}
      onClose={onClose}
      eyebrow={lead ? (LEAD_SOURCE_LABEL[lead.source as LeadSource] ?? lead.source) : "Lead"}
      title={lead?.businessName ?? "Loading…"}
      footer={
        lead && lead.stage === "WON" && !lead.convertedClient ? (
          <Button
            fullWidth
            loading={busy}
            icon={<ArrowRight className="h-4 w-4" />}
            onClick={() => void convert()}
          >
            Convert to client
          </Button>
        ) : undefined
      }
    >
      {state === "loading" && (
        <div className="space-y-3 p-5">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-40 rounded-card" />
        </div>
      )}

      {state === "error" && (
        <ErrorState
          title="Couldn't load this lead"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      )}

      {state === "ready" && lead && (
        <div className="space-y-6 p-5">
          {/* Facts */}
          <div className="rounded-card border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-display text-2xl font-extrabold tabular-nums leading-none text-ink">
                  {formatMoney(lead.estimatedMonthlyValue)}
                  <span className="ml-1 text-[13px] font-medium text-ink/40">/month</span>
                </p>
                <p className="mt-1.5 text-[13px] text-ink/55">
                  {lead.contactName}
                  {lead.country ? ` · ${lead.country}` : ""}
                </p>
              </div>
              <Badge tone={STAGE_TONE[lead.stage]} dot>
                {STAGE_LABEL[lead.stage]}
              </Badge>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="inline-flex items-center gap-1.5 text-ink/60 hover:text-brand"
                >
                  <Mail className="h-3.5 w-3.5" />
                  {lead.email}
                </a>
              )}
              {lead.phone && (
                <a
                  href={`tel:${lead.phone}`}
                  className="inline-flex items-center gap-1.5 text-ink/60 hover:text-brand"
                >
                  <Phone className="h-3.5 w-3.5" />
                  {lead.phone}
                </a>
              )}
            </div>

            {lead.owner && (
              <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
                <Avatar name={lead.owner.name} color={lead.owner.avatarColor} size="sm" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{lead.owner.name}</p>
                  <p className="truncate text-[11px] text-ink/45">{lead.owner.jobTitle}</p>
                </div>
              </div>
            )}

            {lead.notes && (
              <p className="mt-3 border-t border-line pt-3 text-[13px] leading-relaxed text-ink/60">
                {lead.notes}
              </p>
            )}

            {lead.stage === "LOST" && lead.lostReason && (
              <div className="mt-3 rounded-[10px] border border-danger/20 bg-danger-tint px-3 py-2.5">
                <p className="text-[13px] font-medium text-danger">
                  {LOST_REASON_LABEL[lead.lostReason as LostReason] ?? lead.lostReason}
                </p>
                {lead.lostNote && (
                  <p className="mt-0.5 text-[13px] leading-relaxed text-danger/80">
                    {lead.lostNote}
                  </p>
                )}
              </div>
            )}

            {lead.convertedClient && (
              <p className="mt-3 rounded-[10px] border border-brand/20 bg-brand-tint px-3 py-2.5 text-[13px] text-brand">
                Became {lead.convertedClient.businessName}
                {lead.convertedAt ? ` on ${formatDate(lead.convertedAt)}` : ""}.
              </p>
            )}
          </div>

          {/* Quick log */}
          {!closed && data.canEdit && (
            <div>
              <p className="mb-2 text-[13px] font-medium text-ink/80">Log what you did</p>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {ACTIVITY_TYPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setType(option)}
                    className={cn(
                      "rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                      type === option
                        ? "border-brand bg-brand text-paper"
                        : "border-line bg-white text-ink/55 hover:border-ink/25",
                    )}
                  >
                    {ACTIVITY_LABEL[option]}
                  </button>
                ))}
              </div>

              <Textarea
                rows={2}
                value={note}
                placeholder="Spoke to Claire, walking her through the funnel audit next Tuesday."
                onChange={(event) => setNote(event.target.value)}
              />

              <Button
                className="mt-2"
                size="sm"
                loading={busy}
                disabled={note.trim().length < 3}
                onClick={() => void log()}
              >
                Log {ACTIVITY_LABEL[type].toLowerCase()}
              </Button>
            </div>
          )}

          {/* Timeline */}
          <div>
            <p className="mb-3 text-[13px] font-medium text-ink/80">
              Activity
              {lead.activities.length > 0 && (
                <span className="ml-2 font-normal text-ink/45">
                  {lead.activities.length}
                </span>
              )}
            </p>

            {lead.activities.length === 0 ? (
              <EmptyState
                icon={Mail}
                title="Nothing logged yet"
                description="Every call, email and DM logged here counts towards weekly activity targets."
              />
            ) : (
              <ol className="relative space-y-4 border-l border-line pl-5">
                {lead.activities.map((activity) => (
                  <li key={activity.id} className="group relative">
                    <span className="absolute -left-[23px] top-1.5 h-2 w-2 rounded-full bg-brand ring-4 ring-paper" />

                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium text-ink">
                          {ACTIVITY_LABEL[activity.type as ActivityType] ?? activity.type}
                          <span className="ml-2 text-[12px] font-normal text-ink/45">
                            {activity.user.name}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[13px] leading-relaxed text-ink/60">
                          {activity.note}
                        </p>
                        <p className="mt-1 text-[11px] text-ink/35">
                          {formatDateTime(activity.occurredAt)}
                        </p>
                      </div>

                      <button
                        type="button"
                        aria-label="Remove this entry"
                        onClick={() => void removeActivity(activity.id)}
                        className="rounded p-1 text-ink/20 opacity-0 transition-opacity hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </Drawer>
  );
}
