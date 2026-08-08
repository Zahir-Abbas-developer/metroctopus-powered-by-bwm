"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Layers, Plus, Search, SlidersHorizontal } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Skeleton } from "@/components/ui/Skeleton";
import { ClientCard } from "@/components/clients/ClientCard";
import { ClientWizard } from "@/components/clients/ClientWizard";
import {
  ServiceCatalogModal,
  type CatalogService,
} from "@/components/clients/ServiceCatalogModal";
import { CLIENT_STATUSES, CLIENT_STATUS_LABEL, type ClientStatus } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ClientSummary, ServiceSummary } from "@/lib/types";

type Filter = ClientStatus | "ALL";
type Status = "loading" | "ready" | "error";

const FILTERS: Filter[] = ["ALL", ...CLIENT_STATUSES];

export function ClientsBrowser({
  services,
  catalog,
}: {
  /** Active services, for the onboarding wizard. */
  services: ServiceSummary[];
  /** Every service including retired ones, for the catalogue manager. */
  catalog: CatalogService[];
}) {
  const [clients, setClients] = useState<ClientSummary[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [filter, setFilter] = useState<Filter>("ALL");
  const [query, setQuery] = useState("");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [wizardOpen, setWizardOpen] = useState(false);
  // Set by the pipeline when a won deal is converted.
  const convertLeadId = searchParams.get("convert");
  const [catalogOpen, setCatalogOpen] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/clients", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = (await response.json()) as { clients: ClientSummary[] };
      setClients(body.clients);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Filtering client-side: the whole book of business is a few dozen rows, and
  // a round trip per keystroke would be slower than the filter itself.
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients.filter((client) => {
      if (filter !== "ALL" && client.status !== filter) return false;
      if (!needle) return true;
      return (
        client.businessName.toLowerCase().includes(needle) ||
        client.contactName.toLowerCase().includes(needle) ||
        (client.industry ?? "").toLowerCase().includes(needle)
      );
    });
  }, [clients, filter, query]);

  const counts = useMemo(() => {
    const map = new Map<Filter, number>([["ALL", clients.length]]);
    for (const value of CLIENT_STATUSES) {
      map.set(value, clients.filter((client) => client.status === value).length);
    }
    return map;
  }, [clients]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Book of business"
        title="Clients"
        description="Every account on retainer, what they've bought, and how this month's delivery is tracking."
        actions={
          <>
            <Button
              variant="secondary"
              icon={<Layers className="h-4 w-4" />}
              onClick={() => setCatalogOpen(true)}
            >
              Services
            </Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
              Onboard client
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map((value) => {
            const active = filter === value;
            const count = counts.get(value) ?? 0;

            return (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value)}
                className={cn(
                  "flex items-center gap-1.5 rounded-pill border px-3 py-1.5 text-[13px] transition-colors",
                  active
                    ? "border-ink bg-ink text-paper"
                    : "border-line bg-white text-ink/60 hover:border-ink/25 hover:text-ink",
                )}
              >
                {value === "ALL" ? "All" : CLIENT_STATUS_LABEL[value]}
                <span className={cn("text-[11px] tabular-nums", active ? "text-paper/50" : "text-ink/35")}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="w-full sm:w-64">
          <Input
            placeholder="Search clients"
            icon={<Search className="h-4 w-4" />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search clients"
          />
        </div>
      </div>

      {status === "loading" && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[248px] rounded-card" />
          ))}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-card border border-line bg-white">
          <ErrorState
            title="Couldn't load your clients"
            description="The client list didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </div>
      )}

      {status === "ready" && clients.length === 0 && (
        <div className="rounded-card border border-line bg-white">
          <EmptyState
            icon={Building2}
            eyebrow="No clients yet"
            title="Onboard your first client"
            description="Capture their details, pick the services they've bought, and Agency OS builds the month's plan for you."
            action={
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => setWizardOpen(true)}>
                Onboard a client
              </Button>
            }
          />
        </div>
      )}

      {status === "ready" && clients.length > 0 && visible.length === 0 && (
        <div className="rounded-card border border-line bg-white">
          <EmptyState
            icon={SlidersHorizontal}
            eyebrow="No matches"
            title="Nothing fits those filters"
            description="Try a different status, or clear the search to see the whole book again."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setFilter("ALL");
                  setQuery("");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </div>
      )}

      {status === "ready" && visible.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((client) => (
            <ClientCard key={client.id} client={client} />
          ))}
        </div>
      )}

      <ClientWizard
        open={wizardOpen || Boolean(convertLeadId)}
        services={services}
        convertLeadId={convertLeadId}
        onClose={() => {
          setWizardOpen(false);
          if (convertLeadId) router.replace("/clients");
        }}
      />

      <ServiceCatalogModal
        open={catalogOpen}
        services={catalog}
        onClose={() => setCatalogOpen(false)}
      />
    </div>
  );
}
