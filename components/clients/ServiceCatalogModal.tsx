"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Check, Plus, RotateCcw, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SERVICE_TEMPLATES } from "@/lib/templates";
import { cn } from "@/lib/utils";

export type CatalogService = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
};

/**
 * The agency's offerings, editable by the owner.
 *
 * Renaming is safe: the `slug` keys the built-in planning template and never
 * changes, so "Google Ads Management" can become anything without orphaning
 * the plan it generates. A service the owner adds themselves has no template,
 * which the list says plainly.
 */
export function ServiceCatalogModal({
  open,
  services,
  onClose,
}: {
  open: boolean;
  services: CatalogService[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<CatalogService[]>(services);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRows(services);
    setEditingId(null);
    setNewName("");
    setError(null);
  }, [open, services]);

  async function request(id: string | null, run: () => Promise<Response>) {
    setBusyId(id ?? "new");
    setError(null);

    try {
      const response = await run();
      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(body?.error ?? "That didn't work. Please try again.");
        return false;
      }

      router.refresh();
      return true;
    } catch {
      setError("We couldn't reach the server. Check your connection and retry.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function add() {
    if (newName.trim().length < 2) {
      setError("Give the service a name of at least 2 characters.");
      return;
    }

    setAdding(true);
    const ok = await request(null, () =>
      fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      }),
    );
    setAdding(false);
    if (ok) setNewName("");
  }

  async function rename(id: string) {
    if (draftName.trim().length < 2) {
      setError("A service name needs at least 2 characters.");
      return;
    }

    const ok = await request(id, () =>
      fetch(`/api/services/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: draftName.trim() }),
      }),
    );
    if (ok) setEditingId(null);
  }

  function toggle(service: CatalogService) {
    void request(service.id, () =>
      fetch(`/api/services/${service.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !service.isActive }),
      }),
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      eyebrow="Catalogue"
      title="Services you offer"
      description="These are what the onboarding wizard offers, and what generates each engagement's plan."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2.5 rounded-[10px] border border-danger/20 bg-danger-tint px-3.5 py-3 text-[13px] leading-relaxed text-danger"
          >
            <AlertCircle aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
          {rows.map((service) => {
            const template = SERVICE_TEMPLATES[service.slug];
            const busy = busyId === service.id;

            return (
              <li
                key={service.id}
                className={cn(
                  "flex items-center gap-3 px-4 py-3",
                  !service.isActive && "bg-paper/60",
                  busy && "opacity-60",
                )}
              >
                {editingId === service.id ? (
                  <>
                    <Input
                      autoFocus
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      disabled={busy}
                      aria-label="Service name"
                      className="h-9"
                    />
                    <Button size="sm" onClick={() => rename(service.id)} loading={busy}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "truncate text-sm font-medium",
                          service.isActive ? "text-ink" : "text-ink/45",
                        )}
                      >
                        {service.name}
                      </p>
                      <p className="truncate text-[12px] text-ink/45">
                        {template
                          ? `${template.milestones.length} milestone template`
                          : "No template — its projects start with reporting only"}
                        {!service.isActive && " · retired"}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(service.id);
                        setDraftName(service.name);
                      }}
                    >
                      Rename
                    </Button>

                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => toggle(service)}
                      icon={
                        service.isActive ? (
                          <X className="h-3.5 w-3.5" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )
                      }
                      className={service.isActive ? "hover:text-danger" : "hover:text-brand"}
                    >
                      {service.isActive ? "Retire" : "Restore"}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>

        <div className="flex items-end gap-2.5 rounded-card border border-dashed border-line p-4">
          <Input
            label="Add a service"
            placeholder="Email & SMS Marketing"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            disabled={adding}
          />
          <Button onClick={add} loading={adding} icon={<Plus className="h-4 w-4" />}>
            Add
          </Button>
        </div>

        <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink/45">
          <Check aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          Renaming is safe — the five built-in services keep their planning
          templates whatever you call them. Retiring one hides it from
          onboarding without touching engagements already running.
        </p>
      </div>
    </Modal>
  );
}
