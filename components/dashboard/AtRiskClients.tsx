import Link from "next/link";
import { HeartPulse } from "lucide-react";

import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { buttonClasses } from "@/components/ui/Button";
import { HEALTH_BAND_COLOR, HEALTH_BAND_LABEL, type HealthBand } from "@/lib/clientHealth";

export type AtRiskRow = {
  clientId: string;
  clientName: string;
  score: number;
  band: HealthBand;
  headline: string | null;
};

/**
 * The clients worth worrying about, worst first.
 *
 * Every row names *why* rather than only how bad — a list of scores tells the
 * owner something is wrong; a list of reasons tells them what to do this
 * morning. The reason comes from whichever health dimension scored lowest.
 */
export function AtRiskClients({ rows }: { rows: AtRiskRow[] }) {
  return (
    <Card padded={false}>
      <CardHeader
        title="Clients needing attention"
        description="Delivery, performance, payment and responsiveness, blended"
        action={
          <Link href="/clients" className={buttonClasses("ghost", "sm")}>
            All clients
          </Link>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={HeartPulse}
          eyebrow="All healthy"
          title="Nobody needs chasing"
          description="Every client is delivering on time, performing against target, paying, and responsive."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <li key={row.clientId}>
              <Link
                href={`/clients/${row.clientId}`}
                className="flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-cream/50"
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: HEALTH_BAND_COLOR[row.band] }}
                />

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{row.clientName}</p>
                  <p className="truncate text-[12px] text-ink/45">
                    {row.headline ?? HEALTH_BAND_LABEL[row.band]}
                  </p>
                </div>

                <span
                  className="shrink-0 font-display text-sm font-bold tabular-nums"
                  style={{ color: HEALTH_BAND_COLOR[row.band] }}
                >
                  {row.score}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
