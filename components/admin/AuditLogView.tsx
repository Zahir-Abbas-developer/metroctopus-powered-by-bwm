"use client";

import { useCallback, useEffect, useState } from "react";
import { ScrollText, ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatDateTime } from "@/lib/date";
import { AUDIT_ACTIONS, AUDIT_ACTION_LABEL, type AuditAction } from "@/lib/audit";

type Entry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string;
  asLead: boolean;
  createdAt: string;
  actor: { id: string; name: string; avatarColor: string; role: string } | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};

/**
 * Every exercise of authority, with what changed.
 *
 * The before/after pair is why this exists rather than a list of summaries:
 * "adjusted a score" is a note; "−2 → 0 on this event, by this person, at this
 * time" is a record. Only the fields that moved are stored, so a reviewer
 * isn't diffing two blobs by eye.
 */
export function AuditLogView() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [actors, setActors] = useState<{ id: string; name: string }[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [action, setAction] = useState("ALL");
  const [actorId, setActorId] = useState("ALL");
  const [leadOnly, setLeadOnly] = useState(false);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const params = new URLSearchParams({ action, actorId, take: "150" });
      if (leadOnly) params.set("asLead", "1");

      const response = await fetch(`/api/audit?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      const body = (await response.json()) as {
        entries: Entry[];
        actors: { id: string; name: string }[];
      };
      setEntries(body.entries);
      setActors(body.actors);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [action, actorId, leadOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Accountability"
        title="Audit log"
        description="Who exercised authority, over what, and what it was before. Score adjustments, dispute rulings, role changes, settings edits and excusals."
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full max-w-[240px]">
          <Select
            label="Action"
            value={action}
            onChange={(event) => setAction(event.target.value)}
            options={[
              { value: "ALL", label: "Everything" },
              ...AUDIT_ACTIONS.map((value) => ({
                value,
                label: AUDIT_ACTION_LABEL[value as AuditAction],
              })),
            ]}
          />
        </div>

        <div className="w-full max-w-[220px]">
          <Select
            label="Who"
            value={actorId}
            onChange={(event) => setActorId(event.target.value)}
            options={[
              { value: "ALL", label: "Anyone" },
              ...actors.map((person) => ({ value: person.id, label: person.name })),
            ]}
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 pb-2.5 text-[13px] text-ink/70">
          <input
            type="checkbox"
            checked={leadOnly}
            onChange={(event) => setLeadOnly(event.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          Delegated only
        </label>
      </div>

      {state === "loading" && <Skeleton className="h-[420px] rounded-card" />}

      {state === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load the audit log"
            description="This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {state === "ready" && (
        <Card padded={false}>
          {entries.length === 0 ? (
            <EmptyState
              icon={ScrollText}
              title="Nothing matches"
              description="No sensitive actions have been recorded under those filters."
            />
          ) : (
            <ul className="divide-y divide-line">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3.5 px-5 py-3.5">
                  {entry.actor ? (
                    <Avatar name={entry.actor.name} color={entry.actor.avatarColor} size="sm" />
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-[10px] text-ink/35">
                      sys
                    </span>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink">
                      <span className="font-medium">{entry.actor?.name ?? "System"}</span>
                      <span className="text-ink/55">{entry.summary}</span>
                      {entry.asLead && (
                        <Badge size="sm" tone="info">
                          as Service Lead
                        </Badge>
                      )}
                    </p>

                    {(entry.before || entry.after) && (
                      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink/45">
                        {Object.keys({ ...entry.before, ...entry.after }).map((key) => (
                          <span key={key}>
                            {key}: {format(entry.before?.[key])} → {format(entry.after?.[key])}
                          </span>
                        ))}
                      </p>
                    )}

                    <p className="mt-1 text-[11px] text-ink/35">
                      {AUDIT_ACTION_LABEL[entry.action as AuditAction] ?? entry.action} ·{" "}
                      {entry.entityType} · {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="flex items-center gap-2 border-t border-line px-5 py-3 text-[12px] text-ink/40">
            <ShieldCheck className="h-3.5 w-3.5" />
            Append-only. Nothing here is edited or removed, including by the owner.
          </p>
        </Card>
      )}
    </div>
  );
}

function format(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
