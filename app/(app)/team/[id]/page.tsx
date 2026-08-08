import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { currentCycle, ledgerFor, onTimeRateFor, performanceContext, scoresForCycle } from "@/lib/score-service";
import { monthlyScore, scoreBand } from "@/lib/scoring";
import { PerformanceProfile } from "@/components/performance/PerformanceProfile";
import { qualityForCycle } from "@/lib/quality-service";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const member = await prisma.user.findUnique({
    where: { id: params.id },
    select: { name: true },
  });

  return { title: member?.name ?? "Team member" };
}

export default async function TeamMemberPage({ params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  const cycle = currentCycle();

  const member = await prisma.user.findUnique({
    where: { id: params.id },
    select: { id: true, name: true, jobTitle: true, avatarColor: true },
  });

  if (!member) notFound();

  const [scores, ledger, onTime, context, quality] = await Promise.all([
    scoresForCycle([member.id], cycle),
    ledgerFor(member.id, cycle),
    onTimeRateFor([member.id], cycle),
    performanceContext([member.id], cycle),
    qualityForCycle(member.id, cycle),
  ]);

  const score = scores.get(member.id) ?? {
    userId: member.id,
    score: monthlyScore([]),
    band: scoreBand(monthlyScore([])),
    trend: null,
    eventCount: 0,
    deductions: 0,
    bonuses: 0,
  };

  return (
    <PerformanceProfile
      member={member}
      score={score}
      ledger={ledger}
      cycle={cycle}
      onTime={onTime.get(member.id) ?? { onTime: 0, total: 0, rate: 0 }}
      load={{
        count: context.get(member.id)?.load ?? 0,
        weight: context.get(member.id)?.totalWeight ?? 0,
      }}
      quality={quality}
      viewerIsAdmin
      isSelf={member.id === admin.id}
    />
  );
}
