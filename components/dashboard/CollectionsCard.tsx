import Link from "next/link";
import { AlertCircle, Receipt } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMoney } from "@/lib/pipeline-types";
import type { Collections } from "@/lib/payments";

/**
 * What has been invoiced and hasn't arrived.
 *
 * MRR without this is a number the owner can't act on — it counts what was
 * *agreed*, not what landed. An unpaid retainer is also rarely about cash
 * flow: it is usually the first visible symptom of a client who has stopped
 * seeing the value, which is why it feeds the health score too.
 */
export function CollectionsCard({ collections }: { collections: Collections }) {
  const { overdueClients } = collections;

  return (
    <Card padded={false}>
      <CardHeader
        title="Collections"
        description="Retainer cycles invoiced and still outstanding"
        action={
          collections.outstanding > 0 ? (
            <span className="font-display text-base font-bold tabular-nums text-ink">
              {formatMoney(collections.outstanding, true)}
            </span>
          ) : undefined
        }
      />

      {overdueClients.length === 0 ? (
        <EmptyState
          icon={Receipt}
          eyebrow="All settled"
          title="Nothing overdue"
          description={
            collections.outstanding > 0
              ? `${formatMoney(collections.outstanding)} is invoiced and not yet due.`
              : "Every cycle is paid."
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {overdueClients.slice(0, 5).map((row) => (
              <li key={row.projectId} className="flex items-center gap-3 px-5 py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border border-danger/20 bg-danger-tint text-danger">
                  <AlertCircle className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <Link
                    href={`/clients/${row.clientId}`}
                    className="block truncate text-sm font-medium text-ink hover:text-brand"
                  >
                    {row.clientName}
                  </Link>
                  <p className="truncate text-[12px] text-ink/45">
                    {row.title} · {row.daysOverdue} days
                  </p>
                </div>

                <span className="shrink-0 font-display text-sm font-bold tabular-nums text-danger">
                  {formatMoney(row.amount, true)}
                </span>
              </li>
            ))}
          </ul>

          {overdueClients.length > 5 && (
            <p className="border-t border-line px-5 py-3 text-[12px] text-ink/40">
              Showing the 5 oldest of {overdueClients.length}.
            </p>
          )}
        </>
      )}
    </Card>
  );
}
