"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/Button";
import type { EvaluationResult } from "@/lib/evaluate";

/**
 * Triggers the daily evaluation pass by hand.
 *
 * The run is idempotent, so pressing this twice is harmless — the second pass
 * finds every charge already in the ledger and writes nothing.
 */
export function RunEvaluationButton() {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/cron/evaluate", { method: "POST" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error ?? "The evaluation run failed.");
        return;
      }

      setResult((await response.json()) as EvaluationResult);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Check your connection and retry.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button
        variant="secondary"
        size="sm"
        loading={running}
        onClick={run}
        icon={<RefreshCw className="h-3.5 w-3.5" />}
      >
        Run evaluation
      </Button>

      {result && (
        <p className="flex items-center gap-1.5 text-right text-[12px] text-ink/50">
          <CheckCircle2 aria-hidden className="h-3.5 w-3.5 text-brand" />
          {summarize(result)}
        </p>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-right text-[12px] text-danger">
          <AlertCircle aria-hidden className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
    </div>
  );
}

function summarize(result: EvaluationResult): string {
  const parts: string[] = [];
  if (result.lateOrBonusApplied > 0) parts.push(`${result.lateOrBonusApplied} scored`);
  if (result.projectsClosed > 0) parts.push(`${result.projectsClosed} closed out`);
  if (result.milestonesMissed > 0) parts.push(`${result.milestonesMissed} marked missed`);
  if (result.overdueOpen > 0) parts.push(`${result.overdueOpen} still overdue`);

  return parts.length > 0 ? parts.join(" · ") : "Everything already up to date";
}
