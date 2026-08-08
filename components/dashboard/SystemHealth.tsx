import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { HealthReport } from "@/lib/ops";

/**
 * A one-line answer to "is anything quietly broken?"
 *
 * Small on purpose. When everything is fine it is a green line the owner's eye
 * skips; when a job has stopped running it is the only red thing on a page of
 * healthy numbers, which is exactly the contrast a silent failure needs.
 */
export function SystemHealth({ report }: { report: HealthReport }) {
  const ok = report.status === "ok";
  const problems = [
    ...(report.database.ok ? [] : ["database unreachable"]),
    ...report.jobs.filter((job) => job.stale).map((job) => `${job.job} ${describeJob(job)}`),
    ...(report.backup.stale
      ? [
          report.backup.hoursSince === null
            ? "no backup recorded"
            : `backup ${Math.round(report.backup.hoursSince)}h old`,
        ]
      : []),
  ];

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-card border px-4 py-2.5 text-[13px]",
        ok ? "border-line bg-white text-ink/50" : "border-danger/25 bg-danger-tint text-danger",
      )}
    >
      {ok ? (
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-brand" />
      ) : (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      )}

      <span className="min-w-0 flex-1">
        {ok ? (
          <>
            Everything is running.{" "}
            <span className="text-ink/35">
              {report.jobs
                .map((job) => `${job.job} ${job.hoursSince ?? 0}h ago`)
                .join(" · ")}
            </span>
          </>
        ) : (
          <>Needs attention: {problems.join(", ")}.</>
        )}
      </span>

      <Activity className="h-3.5 w-3.5 shrink-0 opacity-40" />
    </div>
  );
}

function describeJob(job: HealthReport["jobs"][number]): string {
  if (job.status === "NEVER_RUN") return "has never run";
  if (job.status === "FAILED") return "failed";
  return `last ran ${Math.round(job.hoursSince ?? 0)}h ago`;
}
