import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { parsePayload, REPORT_TYPE_LABEL, type ReportType } from "@/lib/reports";
import { MemberReportDocument } from "@/components/reports/MemberReportDocument";
import { ClientReportDocument } from "@/components/reports/ClientReportDocument";
import { PrintButton } from "@/components/reports/PrintButton";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const report = await prisma.report.findUnique({
    where: { id: params.id },
    select: { payload: true, type: true },
  });
  if (!report) return { title: "Report" };

  const payload = parsePayload(report.payload);
  const subject = payload.kind === "MEMBER" ? payload.member.name : payload.client.name;
  return { title: `${subject} · ${payload.period.label}` };
}

export default async function ReportPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const report = await prisma.report.findUnique({ where: { id: params.id } });
  if (!report) notFound();

  // A member may open their own reports and nothing else. Client reports are
  // internal to the owner for now.
  const isAdmin = user.role === "ADMIN";
  if (!isAdmin && report.userId !== user.id) notFound();

  const payload = parsePayload(report.payload);
  const backHref = isAdmin ? "/reports" : "/my-reports";

  return (
    <div className="space-y-6">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-[13px] text-ink/50 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {isAdmin ? "All reports" : "My reports"}
        </Link>

        <PrintButton />
      </div>

      {payload.kind === "MEMBER" ? (
        <MemberReportDocument
          payload={payload}
          type={report.type as ReportType}
          generatedAt={report.generatedAt.toISOString()}
          // The owner reads about the member; the member reads about themselves.
          voice={isAdmin && report.userId !== user.id ? "third" : "second"}
        />
      ) : (
        <ClientReportDocument
          payload={payload}
          generatedAt={report.generatedAt.toISOString()}
        />
      )}

      <p className="no-print text-center text-[12px] text-ink/35">
        This {REPORT_TYPE_LABEL[report.type as ReportType].toLowerCase()} is a frozen
        snapshot taken when it was generated. Later changes to the underlying work
        do not alter it.
      </p>
    </div>
  );
}
