"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, FileText, Sparkles } from "lucide-react";

import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState, ErrorState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Select } from "@/components/ui/Select";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { GenerateReportsModal } from "@/components/reports/GenerateReportsModal";
import { REPORT_TYPES, REPORT_TYPE_LABEL, REPORT_TYPE_TONE, type ReportType } from "@/lib/reports";
import { formatDate } from "@/lib/date";
import { cn } from "@/lib/utils";

type Status = "loading" | "ready" | "error";

export type ReportRow = {
  id: string;
  type: ReportType;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  generatedAt: string;
  subject: { kind: "MEMBER" | "CLIENT"; name: string; color: string | null };
  headline: string;
  score: number | null;
  bandColor: string | null;
};

export type MemberOption = { id: string; name: string };

export function ReportsBrowser({
  isAdmin,
  members = [],
}: {
  isAdmin: boolean;
  members?: MemberOption[];
}) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [type, setType] = useState<ReportType | "ALL">("ALL");
  const [memberId, setMemberId] = useState<string>("ALL");
  const [period, setPeriod] = useState<string>("ALL");
  const [generating, setGenerating] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch("/api/reports", { cache: "no-store" });
      if (!response.ok) throw new Error("request failed");
      const body = (await response.json()) as { reports: ReportRow[] };
      setReports(body.reports);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Periods present in the data, newest first — no point offering empty ones.
  const periods = useMemo(() => {
    const seen = new Map<string, string>();
    for (const report of reports) {
      if (!seen.has(report.periodStart)) seen.set(report.periodStart, report.periodLabel);
    }
    return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [reports]);

  const visible = useMemo(
    () =>
      reports.filter((report) => {
        if (type !== "ALL" && report.type !== type) return false;
        if (period !== "ALL" && report.periodStart !== period) return false;
        if (isAdmin && memberId !== "ALL") {
          const match = members.find((m) => m.id === memberId);
          if (!match || report.subject.name !== match.name) return false;
        }
        return true;
      }),
    [reports, type, period, memberId, isAdmin, members],
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Performance"
        title={isAdmin ? "Reports" : "My reports"}
        description={
          isAdmin
            ? "Every generated report. Weekly reports run on Mondays and monthly ones on the 1st; you can also generate a period by hand."
            : "Your weekly and monthly performance, written up at the close of each period."
        }
        actions={
          isAdmin ? (
            <Button
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => setGenerating(true)}
            >
              Generate reports
            </Button>
          ) : undefined
        }
      />

      {status === "ready" && reports.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Select
            label="Type"
            options={[
              { value: "ALL", label: "All types" },
              ...REPORT_TYPES.map((value) => ({ value, label: REPORT_TYPE_LABEL[value] })),
            ]}
            value={type}
            onChange={(event) => setType(event.target.value as ReportType | "ALL")}
          />

          {isAdmin && (
            <Select
              label="Member"
              options={[
                { value: "ALL", label: "Everyone" },
                ...members.map((member) => ({ value: member.id, label: member.name })),
              ]}
              value={memberId}
              onChange={(event) => setMemberId(event.target.value)}
            />
          )}

          <Select
            label="Period"
            options={[
              { value: "ALL", label: "All periods" },
              ...periods.map(([value, label]) => ({ value, label })),
            ]}
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
          />
        </div>
      )}

      {status === "loading" && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-28 rounded-card" />
          ))}
        </div>
      )}

      {status === "error" && (
        <Card padded={false}>
          <ErrorState
            title="Couldn't load reports"
            description="The report list didn't come back. This is usually temporary."
            onRetry={() => void load()}
          />
        </Card>
      )}

      {status === "ready" && reports.length === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={FileText}
            eyebrow="Nothing yet"
            title="No reports generated"
            description={
              isAdmin
                ? "Weekly reports generate on Mondays and monthly ones on the 1st. You can also generate a period right now."
                : "Your first report will appear here at the close of this week."
            }
            action={
              isAdmin ? (
                <Button onClick={() => setGenerating(true)}>Generate reports</Button>
              ) : undefined
            }
          />
        </Card>
      )}

      {status === "ready" && reports.length > 0 && visible.length === 0 && (
        <Card padded={false}>
          <EmptyState
            icon={FileText}
            eyebrow="No matches"
            title="Nothing fits those filters"
            description="Try a different type or period."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  setType("ALL");
                  setMemberId("ALL");
                  setPeriod("ALL");
                }}
              >
                Clear filters
              </Button>
            }
          />
        </Card>
      )}

      {status === "ready" && visible.length > 0 && (
        <div className="space-y-3">
          {visible.map((report) => (
            <Link
              key={report.id}
              href={`/reports/${report.id}`}
              className="flex items-start gap-4 rounded-card border border-line bg-white p-5 transition-colors hover:border-ink/20"
            >
              {report.subject.kind === "MEMBER" ? (
                <Avatar
                  name={report.subject.name}
                  color={report.subject.color ?? "#1A6B3A"}
                  size="md"
                />
              ) : (
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-line bg-cream text-ink/50">
                  <FileText className="h-4 w-4" />
                </span>
              )}

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-display text-[15px] font-bold tracking-tight text-ink">
                    {report.subject.name}
                  </h3>
                  <Badge size="sm" tone={REPORT_TYPE_TONE[report.type]}>
                    {REPORT_TYPE_LABEL[report.type]}
                  </Badge>
                  <span className="text-[12px] text-ink/40">{report.periodLabel}</span>
                </div>

                <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-ink/55">
                  {report.headline}
                </p>

                <p className="mt-1.5 text-[12px] text-ink/35">
                  Generated {formatDate(report.generatedAt)}
                </p>
              </div>

              {report.score !== null && (
                <div className="flex shrink-0 items-center gap-2.5">
                  <ScoreRing score={report.score} size="xs" showValue={false} />
                  <span
                    className={cn("font-display text-sm font-bold tabular-nums text-ink")}
                  >
                    {report.score}
                  </span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}

      {isAdmin && (
        <GenerateReportsModal
          open={generating}
          onClose={() => setGenerating(false)}
          onGenerated={(message) => {
            setGenerating(false);
            toast.success(message);
            void load();
          }}
        />
      )}
    </div>
  );
}
