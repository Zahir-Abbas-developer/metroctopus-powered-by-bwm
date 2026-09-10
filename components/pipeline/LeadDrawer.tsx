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
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
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
  viewer?: { id: string; isAdmin: boolean };
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

          {/* The shared timeline: same quick-log bar, same rail, and — unlike
              the bespoke section this replaced — it shows the entries the app
              writes itself. A stage move made from this drawer was invisible
              here while being visible nowhere else. */}
          <ActivityTimeline
            leadId={lead.id}
            canLog={!closed && data.canEdit}
            viewerId={data.viewer?.id}
            isAdmin={Boolean(data.viewer?.isAdmin)}
            onChanged={onChanged}
          />

        </div>
      )}
    </Drawer>
  );
}
