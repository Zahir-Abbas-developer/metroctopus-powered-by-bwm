"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Mail, Pencil, Phone } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { ErrorState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import {
  LEAD_EDIT_FORM_ID,
  LeadEditForm,
  type EditableLead,
} from "@/components/pipeline/LeadEditForm";
import { formatDate } from "@/lib/date";
import { displayValue, isVisible, type FieldDefinitionView, type FieldValueMap } from "@/lib/fields";
import {
  LEAD_SOURCE_LABEL,
  LOST_REASON_LABEL,
  STAGE_LABEL,
  STAGE_TONE,
  formatMoney,
  type LeadSource,
  type LeadStage,
  type LostReason,
} from "@/lib/pipeline-types";
import { TERMINAL_STAGE_KINDS, WINNING_STAGE_KINDS, type StageKind } from "@/lib/constants";

type Detail = {
  viewer?: { id: string; isAdmin: boolean };
  lead: EditableLead & {
    stage: string;
    stageChangedAt: string;
    lostReason: string | null;
    lostNote: string | null;
    createdAt: string;
    convertedAt: string | null;
    department: { id: string; shortLabel: string } | null;
    owner: { id: string; name: string; avatarColor: string; jobTitle: string } | null;
    convertedClient: { id: string; businessName: string } | null;
  };
  stageInfo: { label: string; kind: string; colorToken: string | null } | null;
  fields: FieldDefinitionView[];
  fieldValues: FieldValueMap;
  canEdit: boolean;
  canMove: boolean;
  canSeeMoney: boolean;
};

/** A department stage's colour, in the badge's vocabulary. */
function toneForStage(kind: string | undefined, colorToken: string | null | undefined): BadgeTone {
  if (kind === "WON" || kind === "ACTIVE_CLIENT") return "success";
  if (kind === "LOST") return "danger";
  const allowed: BadgeTone[] = ["neutral", "info", "warning", "success", "danger"];
  return allowed.includes(colorToken as BadgeTone) ? (colorToken as BadgeTone) : "neutral";
}

/**
 * One deal, and everything that has been done about it.
 *
 * The quick-log row is the point of the drawer: logging a call has to be a
 * two-tap job or it doesn't get logged, and activity that doesn't get logged
 * makes the targets — and therefore the BD score — a fiction.
 *
 * It is also where a lead is corrected. Until the Edit button existed, nothing
 * in the app could change a lead after it was filed.
 */
export function LeadDrawer({
  leadId,
  services = [],
  onClose,
  onChanged,
}: {
  leadId: string | null;
  /** The service catalogue, for the "interested in" choices when editing. */
  services?: { slug: string; name: string }[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<Detail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setEditing(false);
    if (!leadId) {
      setData(null);
      return;
    }
    void load();
  }, [leadId, load]);

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
  const kind = data?.stageInfo?.kind as StageKind | undefined;
  // By the stage's kind, not its key: departments name their stages
  // themselves, and only a few of them call the winning one "WON".
  const closed = kind ? TERMINAL_STAGE_KINDS.includes(kind) : lead?.stage === "WON" || lead?.stage === "LOST";
  const won = kind ? WINNING_STAGE_KINDS.includes(kind) : lead?.stage === "WON";
  const lost = kind ? kind === "LOST" : lead?.stage === "LOST";
  const stageLabel = data?.stageInfo?.label ?? STAGE_LABEL[lead?.stage as LeadStage] ?? lead?.stage;

  const answers =
    data && lead
      ? data.fields
          .filter((field) => isVisible(field, data.fieldValues, data.fields))
          .map((field) => ({ field, value: displayValue(field, data.fieldValues[field.key]) }))
          .filter((row) => row.value)
      : [];

  const footer = editing ? (
    <div className="flex items-center justify-end gap-2">
      <Button variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
        Cancel
      </Button>
      <Button type="submit" form={LEAD_EDIT_FORM_ID} loading={saving}>
        Save changes
      </Button>
    </div>
  ) : lead && won && !lead.convertedClient ? (
    <Button
      fullWidth
      loading={busy}
      icon={<ArrowRight className="h-4 w-4" />}
      onClick={() => void convert()}
    >
      Convert to client
    </Button>
  ) : undefined;

  return (
    <Drawer
      open={Boolean(leadId)}
      onClose={() => {
        if (!saving) onClose();
      }}
      eyebrow={
        editing
          ? "Editing lead"
          : lead
            ? (LEAD_SOURCE_LABEL[lead.source as LeadSource] ?? lead.source)
            : "Lead"
      }
      title={lead?.businessName ?? "Loading…"}
      footer={footer}
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

      {state === "ready" && data && lead && editing && (
        <div className="p-5">
          <LeadEditForm
            lead={lead}
            fields={data.fields}
            fieldValues={data.fieldValues}
            services={services}
            canSeeMoney={data.canSeeMoney}
            canReassign={Boolean(data.viewer?.isAdmin)}
            onSavingChange={setSaving}
            onSaved={() => {
              setEditing(false);
              void load();
              onChanged();
            }}
          />
        </div>
      )}

      {state === "ready" && data && lead && !editing && (
        <div className="space-y-6 p-5">
          {/* Facts */}
          <div className="rounded-card border border-line bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                {data.canSeeMoney && typeof lead.estimatedMonthlyValue === "number" && (
                  <p className="mb-1.5 font-display text-2xl font-extrabold tabular-nums leading-none text-ink">
                    {formatMoney(lead.estimatedMonthlyValue)}
                    <span className="ml-1 text-[13px] font-medium text-ink/40">/month</span>
                  </p>
                )}
                <p className="break-words text-[13px] text-ink/55">
                  {lead.contactName}
                  {lead.country ? ` · ${lead.country}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    data.stageInfo
                      ? toneForStage(data.stageInfo.kind, data.stageInfo.colorToken)
                      : (STAGE_TONE[lead.stage as LeadStage] ?? "neutral")
                  }
                  dot
                >
                  {stageLabel}
                </Badge>
                {data.canEdit && !lead.convertedClient && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<Pencil className="h-3.5 w-3.5" />}
                    onClick={() => setEditing(true)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3 text-[13px]">
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="inline-flex min-w-0 items-center gap-1.5 break-all text-ink/60 hover:text-brand"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0" />
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

            {/* The department's own answers — what was asked when the lead was
                filed, which the drawer used to hold but never show. */}
            {answers.length > 0 && (
              <dl className="mt-4 grid gap-x-4 gap-y-2.5 border-t border-line pt-3 sm:grid-cols-2">
                {answers.map(({ field, value }) => (
                  <div key={field.key} className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-ink/40">{field.label}</dt>
                    <dd className="whitespace-pre-line break-words text-[13px] text-ink/75">{value}</dd>
                  </div>
                ))}
              </dl>
            )}

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
              <p className="mt-3 whitespace-pre-line break-words border-t border-line pt-3 text-[13px] leading-relaxed text-ink/60">
                {lead.notes}
              </p>
            )}

            {lost && lead.lostReason && (
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
