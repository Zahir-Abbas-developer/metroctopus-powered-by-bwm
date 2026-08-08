"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

type Payload = {
  leads: {
    userId: string;
    serviceId: string;
    user: { id: string; name: string; avatarColor: string; isActive: boolean };
    service: { id: string; name: string; slug: string };
  }[];
  services: { id: string; name: string; slug: string }[];
  members: { id: string; name: string; jobTitle: string; avatarColor: string; role: string }[];
};

/**
 * Who can approve what when the owner isn't around.
 *
 * The copy under the heading is the important part. A lead's authority is
 * bounded in two directions and both are enforced server-side — inside their
 * service lines, and never over themselves — and saying so here means nobody
 * has to discover it by being refused.
 */
export function ServiceLeadPanel() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState<Payload["members"][number] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/service-leads", { cache: "no-store" });
      if (!response.ok) throw new Error("failed");
      setData((await response.json()) as Payload);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!editing) return;
    setBusy(true);

    try {
      const response = await fetch("/api/service-leads", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: editing.id, serviceIds: selected }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        toast.error(body?.error ?? "Couldn't save that.");
        return;
      }

      toast.success(
        selected.length === 0
          ? `${editing.name} no longer leads a service line.`
          : `${editing.name} leads ${selected.length} service line${selected.length === 1 ? "" : "s"}.`,
      );
      setEditing(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") return <Skeleton className="h-[280px] rounded-card" />;

  if (state === "error" || !data) {
    return (
      <Card padded={false}>
        <ErrorState
          title="Couldn't load service leads"
          description="This is usually temporary."
          onRetry={() => void load()}
        />
      </Card>
    );
  }

  const byMember = new Map<string, string[]>();
  for (const lead of data.leads) {
    byMember.set(lead.userId, [...(byMember.get(lead.userId) ?? []), lead.service.name]);
  }

  return (
    <>
      <Card>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-ink/40" />
          <h2 className="font-display text-base font-bold tracking-tight text-ink">
            Service leads
          </h2>
        </div>

        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink/55">
          A lead carries the owner&rsquo;s approval authority inside their own
          service lines: approving and rejecting work, excusing checks, ruling
          on outages and disputes. Two limits are enforced by the server, not by
          convention — nothing outside their lines, and{" "}
          <strong className="font-medium text-ink">never their own work</strong>,
          which falls back to the owner.
        </p>

        <ul className="mt-5 divide-y divide-line border-t border-line">
          {data.members.map((member) => {
            const leads = byMember.get(member.id) ?? [];

            return (
              <li key={member.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={member.name} color={member.avatarColor} size="sm" />

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate text-[13px] font-medium text-ink">
                    {member.name}
                    {member.role === "ADMIN" && (
                      <Badge size="sm" tone="info">
                        Owner
                      </Badge>
                    )}
                  </p>
                  <p className="truncate text-[12px] text-ink/45">
                    {leads.length > 0 ? `Leads ${leads.join(", ")}` : member.jobTitle}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setEditing(member);
                    setSelected(
                      data.leads
                        .filter((lead) => lead.userId === member.id)
                        .map((lead) => lead.serviceId),
                    );
                  }}
                >
                  {leads.length > 0 ? "Change" : "Make a lead"}
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.name} leads…` : "Service leads"}
      >
        <div className="space-y-4">
          <p className="text-[13px] leading-relaxed text-ink/60">
            Pick the service lines this person can approve work in. Deselect
            everything to remove their authority.
          </p>

          <div className="space-y-1.5">
            {data.services.map((service) => {
              const active = selected.includes(service.id);
              return (
                <button
                  key={service.id}
                  type="button"
                  onClick={() =>
                    setSelected(
                      active
                        ? selected.filter((id) => id !== service.id)
                        : [...selected, service.id],
                    )
                  }
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5 text-left text-[13px] transition-colors",
                    active
                      ? "border-brand bg-brand-tint/50 text-ink"
                      : "border-line bg-white text-ink/60 hover:border-ink/25",
                  )}
                >
                  {service.name}
                  <span
                    className={cn(
                      "h-4 w-4 shrink-0 rounded-[5px] border",
                      active ? "border-brand bg-brand" : "border-line",
                    )}
                  />
                </button>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
