"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarPlus,
  FileText,
  Hourglass,
  Layers,
  Mail,
  Pencil,
  Phone,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tabs } from "@/components/ui/Tabs";
import { KpiPanel } from "@/components/kpis/KpiPanel";
import { HEALTH_BAND_COLOR, HEALTH_BAND_LABEL } from "@/lib/clientHealth";
import { cn } from "@/lib/utils";
import { ClientEditModal } from "@/components/clients/ClientEditModal";
import { NewEngagementModal } from "@/components/clients/NewEngagementModal";
import { RecordFieldsPanel } from "@/components/fields/RecordFieldsPanel";
import { ActivityTimeline } from "@/components/activity/ActivityTimeline";
import {
  CLIENT_STATUS_LABEL,
  CLIENT_STATUS_TONE,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  type ClientStatus,
  type ProjectStatus,
} from "@/lib/constants";
import { daysUntil, formatDate } from "@/lib/date";
import type { ProjectProgress, ServiceSummary } from "@/lib/types";

export type ClientRecord = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  country: string | null;
  industry: string | null;
  monthlyBudget: number;
  status: ClientStatus;
  notes: string | null;
  /** Off means the nightly job never opens a new cycle for this client. */
  autoRenew: boolean;
  /** Null falls back to the agency default. */
  targetRoas: number | null;
  onboardedAt: string;
};

export type ProjectRecord = {
  id: string;
  title: string;
  status: ProjectStatus;
  startDate: string;
  endDate: string;
  services: ServiceSummary[];
  progress: ProjectProgress;
};

type Tab = "overview" | "kpis" | "projects" | "notes";

export type ClientHealthSummary = {
  score: number;
  band: "HEALTHY" | "WATCH" | "AT_RISK";
  headline: string | null;
  components: { key: string; label: string; score: number | null; detail: string }[];
};

export type ClientWaiting = {
  totalDays: number;
  openItems: { milestoneId: string; title: string; since: string; note: string }[];
};

export function ClientDetail({
  client,
  projects,
  services,
  waiting,
  health,
}: {
  client: ClientRecord;
  projects: ProjectRecord[];
  services: ServiceSummary[];
  /** Delay attributable to this client, from blocked milestones. */
  waiting: ClientWaiting;
  /** Computed, never entered. See lib/clientHealth.ts. */
  health: ClientHealthSummary | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const live = projects.find(
    (project) => project.status === "ACTIVE" || project.status === "PLANNING",
  );

  return (
    <div className="space-y-8">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-[13px] text-ink/50 transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All clients
      </Link>

      {/* Identity header */}
      <Card surface="dark" padded={false}>
        <div className="px-6 py-8 sm:px-9 sm:py-10">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="min-w-0">
              <p className="eyebrow mb-3 text-brand-tint/70">
                {client.industry ?? "Client"}
              </p>
              <h1 className="font-display text-[30px] font-extrabold leading-[1.05] tracking-[-0.02em] text-paper sm:text-[38px]">
                {client.businessName}
              </h1>

              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-paper/55">
                <span>{client.contactName}</span>
                <a
                  href={`mailto:${client.email}`}
                  className="flex items-center gap-1.5 transition-colors hover:text-paper"
                >
                  <Mail aria-hidden className="h-3.5 w-3.5" />
                  {client.email}
                </a>
                {client.phone && (
                  <span className="flex items-center gap-1.5">
                    <Phone aria-hidden className="h-3.5 w-3.5" />
                    {client.phone}
                  </span>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2.5">
              <Badge dot tone={CLIENT_STATUS_TONE[client.status]}>
                {CLIENT_STATUS_LABEL[client.status]}
              </Badge>
              <Button
                variant="secondary"
                size="sm"
                icon={<Pencil className="h-3.5 w-3.5" />}
                onClick={() => setEditing(true)}
              >
                Edit
              </Button>
            </div>
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            <HeaderStat label="Monthly retainer" value={`$${client.monthlyBudget.toLocaleString()}`} />
            <HeaderStat label="Country" value={client.country ?? "—"} />
            <HeaderStat label="Client since" value={formatDate(client.onboardedAt)} />
          </div>
        </div>
      </Card>

      <Tabs
        items={[
          { key: "overview", label: "Overview" },
          { key: "kpis", label: "Performance" },
          { key: "projects", label: "Projects", count: projects.length },
          { key: "notes", label: "Notes" },
        ]}
        active={tab}
        onChange={setTab}
        right={
          <Button
            size="sm"
            variant="secondary"
            icon={<CalendarPlus className="h-3.5 w-3.5" />}
            onClick={() => setCreating(true)}
          >
            New engagement
          </Button>
        }
      />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* This department's own questions. Renders nothing when the business
              line has no fields of its own, rather than an empty panel. */}
          <div className="lg:col-span-3">
            <RecordFieldsPanel
              endpoint={`/api/clients/${client.id}/fields`}
              description="Recorded by this client's business line."
              canEdit
            />
          </div>

          <div className="lg:col-span-3">
            <ActivityTimeline clientId={client.id} />
          </div>

          {health && (
            <Card className="lg:col-span-3">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: HEALTH_BAND_COLOR[health.band] }}
                    />
                    <h2 className="font-display text-base font-bold tracking-tight text-ink">
                      Client health · {HEALTH_BAND_LABEL[health.band]}
                    </h2>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
                    {health.headline ??
                      "Delivering on time, performing against target, paying, and responsive."}
                  </p>
                </div>

                <p className="font-display text-3xl font-extrabold tabular-nums leading-none text-ink">
                  {health.score}
                </p>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {health.components.map((component) => (
                  <div
                    key={component.key}
                    className="rounded-[10px] border border-line px-3.5 py-3"
                    title={component.detail}
                  >
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="text-[13px] text-ink/60">{component.label}</span>
                      <span
                        className={cn(
                          "font-display text-sm font-bold tabular-nums",
                          component.score === null
                            ? "text-ink/25"
                            : component.score >= 75
                              ? "text-brand"
                              : component.score >= 55
                                ? "text-warn"
                                : "text-danger",
                        )}
                      >
                        {component.score === null ? "—" : component.score}
                      </span>
                    </p>
                    <p className="mt-1 text-[11px] leading-snug text-ink/40">
                      {component.detail}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Delay this client caused. Sits at the top of the overview because
              it is the number that changes a "you were late" conversation. */}
          {(waiting.totalDays > 0 || waiting.openItems.length > 0) && (
            <Card className="lg:col-span-3">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Hourglass className="h-4 w-4 text-warn" />
                    <h2 className="font-display text-base font-bold tracking-tight text-ink">
                      Waiting on this client
                    </h2>
                  </div>
                  <p className="mt-1 text-[13px] leading-relaxed text-ink/55">
                    Time our work sat paused waiting for their input. Deadlines
                    shift by exactly this much, and nobody here is charged for it.
                  </p>
                </div>

                <div className="text-right">
                  <p className="font-display text-2xl font-extrabold tabular-nums leading-none text-warn">
                    {waiting.totalDays}
                    <span className="ml-1 text-[13px] font-medium text-ink/40">
                      {waiting.totalDays === 1 ? "day" : "days"}
                    </span>
                  </p>
                  <p className="mt-1 text-[12px] text-ink/45">total this engagement</p>
                </div>
              </div>

              {waiting.openItems.length > 0 && (
                <ul className="mt-4 space-y-2 border-t border-line pt-4">
                  {waiting.openItems.map((item) => (
                    <li key={item.milestoneId} className="flex items-start gap-3">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-warn" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-ink">
                          {item.title}
                        </p>
                        <p className="text-[12px] text-ink/50">
                          {item.note} · since {formatDate(item.since)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          <Card className="lg:col-span-2">
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              Current engagement
            </h2>

            {live ? (
              <div className="mt-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <Link
                      href={`/projects/${live.id}`}
                      className="font-display text-lg font-bold tracking-tight text-ink hover:text-brand"
                    >
                      {live.title}
                    </Link>
                    <p className="mt-1 text-[13px] text-ink/50">
                      {formatDate(live.startDate)} – {formatDate(live.endDate)} ·{" "}
                      {remainingLabel(live.endDate)}
                    </p>
                  </div>
                  <Badge dot tone={PROJECT_STATUS_TONE[live.status]}>
                    {PROJECT_STATUS_LABEL[live.status]}
                  </Badge>
                </div>

                <ProgressBar
                  className="mt-5"
                  value={live.progress.percent}
                  showValue
                  label={`${live.progress.done} of ${live.progress.total} milestones`}
                />

                <div className="mt-5 flex flex-wrap gap-1.5">
                  {live.services.map((service) => (
                    <Badge key={service.id} size="sm">
                      {service.name}
                    </Badge>
                  ))}
                </div>

                <Link
                  href={`/projects/${live.id}`}
                  className={buttonClasses("secondary", "sm", "mt-6")}
                >
                  Open the plan
                </Link>
              </div>
            ) : (
              <EmptyState
                icon={CalendarPlus}
                eyebrow="Nothing live"
                title="No engagement running"
                description="Start a cycle and BWM will lay out the modules and milestones from the services they've bought."
                action={
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Start an engagement
                  </Button>
                }
              />
            )}
          </Card>

          <Card>
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              Details
            </h2>
            <dl className="mt-4 space-y-3 text-sm">
              <Detail label="Contact" value={client.contactName} />
              <Detail label="Email" value={client.email} />
              <Detail label="Phone" value={client.phone ?? "—"} />
              <Detail label="Country" value={client.country ?? "—"} />
              <Detail label="Industry" value={client.industry ?? "—"} />
              <Detail
                label="Retainer"
                value={`$${client.monthlyBudget.toLocaleString()} / month`}
              />
              <Detail label="Engagements" value={String(projects.length)} />
            </dl>
          </Card>
        </div>
      )}

      {tab === "kpis" && <KpiPanel clientId={client.id} canEdit />}

      {tab === "projects" && (
        <div className="space-y-3">
          {projects.length === 0 ? (
            <Card padded={false}>
              <EmptyState
                icon={Layers}
                eyebrow="No history"
                title="No engagements yet"
                description="Every monthly cycle you run for this client will be listed here."
                action={
                  <Button size="sm" onClick={() => setCreating(true)}>
                    Start the first one
                  </Button>
                }
              />
            </Card>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="block rounded-card border border-line bg-white p-5 transition-colors hover:border-ink/20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-display text-base font-bold tracking-tight text-ink">
                      {project.title}
                    </h3>
                    <p className="mt-1 text-[13px] text-ink/50">
                      {formatDate(project.startDate)} – {formatDate(project.endDate)}
                    </p>
                  </div>
                  <Badge dot tone={PROJECT_STATUS_TONE[project.status]}>
                    {PROJECT_STATUS_LABEL[project.status]}
                  </Badge>
                </div>

                <ProgressBar
                  className="mt-4"
                  size="sm"
                  value={project.progress.percent}
                  tone={project.status === "OVERDUE_CLOSEOUT" ? "danger" : "brand"}
                />
                <p className="mt-2 text-[12px] text-ink/40">
                  {project.progress.done} of {project.progress.total} milestones complete
                </p>
              </Link>
            ))
          )}
        </div>
      )}

      {tab === "notes" && (
        <Card>
          <div className="flex items-start justify-between gap-4">
            <h2 className="font-display text-base font-bold tracking-tight text-ink">
              Account notes
            </h2>
            <Button
              size="sm"
              variant="ghost"
              icon={<Pencil className="h-3.5 w-3.5" />}
              onClick={() => setEditing(true)}
            >
              Edit
            </Button>
          </div>

          {client.notes ? (
            <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">
              {client.notes}
            </p>
          ) : (
            <EmptyState
              icon={FileText}
              eyebrow="Empty"
              title="No notes yet"
              description="Context the team should carry into the work — preferences, constraints, who signs things off."
              action={
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  Add a note
                </Button>
              }
            />
          )}
        </Card>
      )}

      <ClientEditModal
        open={editing}
        client={client}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          router.refresh();
        }}
      />

      <NewEngagementModal
        open={creating}
        clientId={client.id}
        clientName={client.businessName}
        services={services}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function HeaderStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-paper/10 bg-paper/[0.04] px-4 py-3">
      <p className="eyebrow text-paper/35">{label}</p>
      <p className="mt-1.5 text-sm font-medium text-paper/85">{value}</p>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0">
      <dt className="text-ink/50">{label}</dt>
      <dd className="text-right font-medium text-ink">{value}</dd>
    </div>
  );
}

function remainingLabel(endDate: string): string {
  const days = daysUntil(endDate);
  if (days < 0) return `ended ${Math.abs(days)} days ago`;
  if (days === 0) return "ends today";
  return `${days} days remaining`;
}
