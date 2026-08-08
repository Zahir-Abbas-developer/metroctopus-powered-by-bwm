import Link from "next/link";
import { ArrowUpRight, Globe2 } from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { CLIENT_STATUS_LABEL, CLIENT_STATUS_TONE } from "@/lib/constants";
import { formatDate } from "@/lib/date";
import type { ClientSummary } from "@/lib/types";

/** Compact money — a retainer book reads better as $4.5k than $4,500. */
function formatBudget(amount: number): string {
  if (amount >= 1000) {
    const thousands = amount / 1000;
    return `$${Number.isInteger(thousands) ? thousands : thousands.toFixed(1)}k`;
  }
  return `$${amount}`;
}

export function ClientCard({ client }: { client: ClientSummary }) {
  const project = client.currentProject;

  return (
    <Link
      href={`/clients/${client.id}`}
      className="group flex flex-col rounded-card border border-line bg-white p-5 transition-colors hover:border-ink/20 focus-visible:border-ink/20"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-display text-[17px] font-bold tracking-tight text-ink">
            {client.businessName}
          </h3>
          <p className="mt-1 truncate text-[13px] text-ink/50">
            {client.industry ?? "Industry not set"}
          </p>
        </div>

        <Badge dot tone={CLIENT_STATUS_TONE[client.status]}>
          {CLIENT_STATUS_LABEL[client.status]}
        </Badge>
      </div>

      <div className="mt-4 flex items-center gap-4 text-[13px] text-ink/55">
        <span className="font-display text-base font-bold text-ink">
          {formatBudget(client.monthlyBudget)}
          <span className="ml-1 text-[11px] font-medium text-ink/40">/mo</span>
        </span>
        {client.country && (
          <span className="flex min-w-0 items-center gap-1.5">
            <Globe2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-ink/35" />
            <span className="truncate">{client.country}</span>
          </span>
        )}
      </div>

      {client.services.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {client.services.slice(0, 3).map((service) => (
            <Badge key={service.id} size="sm" tone="neutral">
              {shortServiceName(service.name)}
            </Badge>
          ))}
          {client.services.length > 3 && (
            <Badge size="sm" tone="neutral">
              +{client.services.length - 3}
            </Badge>
          )}
        </div>
      ) : (
        <p className="mt-4 text-[13px] text-ink/35">No services scoped yet</p>
      )}

      <div className="mt-auto pt-5">
        {project ? (
          <>
            <ProgressBar
              value={project.progress.percent}
              label={project.title}
              showValue
              size="sm"
              tone={project.status === "OVERDUE_CLOSEOUT" ? "danger" : "brand"}
            />
            <p className="mt-2 text-[12px] text-ink/40">
              {project.progress.done} of {project.progress.total} milestones · ends{" "}
              {formatDate(project.endDate)}
            </p>
          </>
        ) : (
          <div className="flex items-center justify-between rounded-[10px] border border-dashed border-line px-3 py-2.5">
            <span className="text-[13px] text-ink/45">No active engagement</span>
            <ArrowUpRight
              aria-hidden
              className="h-3.5 w-3.5 text-ink/30 transition-colors group-hover:text-brand"
            />
          </div>
        )}
      </div>
    </Link>
  );
}

/** "Shopify Design & Development" -> "Shopify" for the card's badge row. */
function shortServiceName(name: string): string {
  return name.split(/[&(]/)[0].replace(/design|management|research/i, "").trim() || name;
}
