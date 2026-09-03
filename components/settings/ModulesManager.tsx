"use client";

import { useCallback, useEffect, useState } from "react";
import { PowerOff } from "lucide-react";

import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

type ModuleRow = { key: string; label: string; description: string };
type Flags = Record<string, boolean>;

/**
 * The parked agency modules and their switches.
 *
 * Turning one off removes it: its nav entries, its dashboard cards, its routes
 * and its background jobs. The copy says so plainly, because "disabled" that
 * leaves debris behind is how people stop trusting a toggle.
 */
export function ModulesManager() {
  const toast = useToast();
  const [modules, setModules] = useState<ModuleRow[]>([]);
  const [flags, setFlags] = useState<Flags>({});
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch("/api/settings/modules");
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setModules(data.modules);
      setFlags(data.flags);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(key: string, enabled: boolean) {
    setSaving(key);
    // Optimistic, then reconciled against what the server actually stored —
    // a switch that lies about its state is worse than a slow one.
    setFlags((prev) => ({ ...prev, [key]: enabled }));
    try {
      const res = await fetch("/api/settings/modules", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setFlags(data.flags);
      toast.success(
        `${modules.find((m) => m.key === key)?.label ?? "Module"} switched ${enabled ? "on" : "off"}`,
      );
    } catch {
      setFlags((prev) => ({ ...prev, [key]: !enabled }));
      toast.error("Couldn't change that module");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Settings"
        title="Modules"
        description="Features inherited from the previous system. Switching one off removes its navigation, its dashboard cards and its scheduled jobs — nothing is left behind, and nothing is deleted."
      />

      {status === "loading" && (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[86px] w-full rounded-card" />
          ))}
        </div>
      )}

      {status === "error" && <ErrorState onRetry={() => void load()} />}

      {status === "ready" && (
        <div className="space-y-3">
          {modules.map((mod) => {
            const on = Boolean(flags[mod.key]);
            return (
              <Card key={mod.key}>
                <CardBody className="flex items-start justify-between gap-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                      <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
                        {mod.label}
                      </h3>
                      <Badge tone={on ? "success" : "neutral"} dot>
                        {on ? "On" : "Off"}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink/55">
                      {mod.description}
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={on}
                    aria-label={`${mod.label} — ${on ? "on" : "off"}`}
                    disabled={saving === mod.key}
                    onClick={() => void toggle(mod.key, !on)}
                    className={cn(
                      "relative mt-0.5 h-6 w-11 shrink-0 rounded-pill border transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-paper",
                      on ? "border-brand bg-brand" : "border-line bg-cream",
                      saving === mod.key && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "absolute top-[3px] h-4 w-4 rounded-pill bg-paper shadow-sm transition-all",
                        on ? "left-[25px]" : "left-[3px]",
                      )}
                    />
                  </button>
                </CardBody>
              </Card>
            );
          })}

          <p className="flex items-start gap-2 px-1 pt-2 text-[13px] leading-relaxed text-ink/45">
            <PowerOff className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Every module here is off by default. Their code is retained, so
            switching one back on restores it without a rebuild.
          </p>
        </div>
      )}
    </div>
  );
}
