import { prisma } from "@/lib/prisma";
import { applyEvents } from "@/lib/score-service";
import { agencyYearMonth, startOfAgencyWeek, endOfAgencyWeek } from "@/lib/date";
import { notify } from "@/lib/notifications";
import { getSettings } from "@/lib/settings";
import { evaluateWeek, type TargetConfig } from "@/lib/targets";
import {
  bucketFor,
  isOpenStage,
  OPEN_STAGES,
  STAGE_LABEL,
  type ActivityBucket,
  type LeadStage,
} from "@/lib/pipeline-types";

/**
 * The sales pipeline: leads, the activity logged against them, and what both
 * are worth.
 *
 * Business development is the one discipline here that doesn't decompose into
 * dated deliverables — a pipeline is worked, not delivered — so it is scored
 * on activity targets and outcomes instead. It writes into the **same**
 * ScoreEvent ledger, not a parallel one, so a member's score remains
 * `100 + sum(that month's events)` however they earned it.
 */

// ---------------------------------------------------------------------------
// Stage moves
// ---------------------------------------------------------------------------

export type StageMoveResult =
  | { ok: true; scored: number }
  | { ok: false; reason: string; field?: string };

/**
 * Moves a lead to a new stage.
 *
 * Deliberately permissive about direction: a deal that goes back from
 * NEGOTIATION to CONTACTED is a real thing that happens, and a state machine
 * that forbade it would just get worked around by deleting and re-creating
 * the lead, losing the activity history that makes the pipeline worth having.
 *
 * The two closed stages are the exceptions. LOST needs a reason, because the
 * reason is the entire point of recording it. WON pays out once — the dedupe
 * key sees to that, so dragging a card out of WON and back in cannot mint a
 * second bonus.
 */
export async function moveStage(options: {
  leadId: string;
  stage: LeadStage;
  actorId: string;
  lostReason?: string | null;
  lostNote?: string | null;
  now?: Date;
}): Promise<StageMoveResult> {
  const now = options.now ?? new Date();
  const settings = await getSettings();

  const lead = await prisma.lead.findUnique({
    where: { id: options.leadId },
    include: { owner: { select: { id: true, name: true } } },
  });
  if (!lead) return { ok: false, reason: "That lead no longer exists." };
  if (lead.stage === options.stage) return { ok: true, scored: 0 };

  if (options.stage === "LOST" && !options.lostReason) {
    return {
      ok: false,
      reason: "Say why it was lost — that's the data worth keeping.",
      field: "lostReason",
    };
  }

  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      stage: options.stage,
      stageChangedAt: now,
      // Moving back out of LOST clears the reason rather than leaving a stale
      // "too expensive" hanging off a live deal.
      lostReason: options.stage === "LOST" ? (options.lostReason ?? null) : null,
      lostNote: options.stage === "LOST" ? (options.lostNote ?? null) : null,
    },
  });

  let scored = 0;

  if (options.stage === "WON" && lead.ownerId) {
    scored = await applyEvents(
      [
        {
          userId: lead.ownerId,
          milestoneId: null,
          type: "DEAL_WON",
          points: Math.abs(settings.bonusDealWon),
          reason: `Closed ${lead.businessName}${
            lead.estimatedMonthlyValue > 0
              ? ` — $${lead.estimatedMonthlyValue.toLocaleString("en-US")}/month`
              : ""
          }.`,
          // One payout per lead, forever. Dragging in and out of WON cannot
          // mint a second bonus.
          dedupeKey: `lead:${lead.id}:WON`,
        },
      ],
      { at: now, createdById: options.actorId },
    );
  }

  // The owner hears about a deal closing and about one being lost — both are
  // things they would otherwise find out about days later in a standup.
  if (options.stage === "WON" || options.stage === "LOST") {
    for (const recipient of await admins()) {
      if (recipient.id === options.actorId) continue;
      await notify({
        userId: recipient.id,
        type: options.stage === "WON" ? "WORK_APPROVED" : "WORK_REJECTED",
        title: options.stage === "WON" ? "Deal won" : "Deal lost",
        body:
          options.stage === "WON"
            ? `${lead.businessName} closed by ${lead.owner?.name ?? "the team"}.`
            : `${lead.businessName} was lost: ${options.lostReason}.`,
        href: "/pipeline",
      });
    }
  }

  return { ok: true, scored };
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

/**
 * Logs a piece of sales work and, where the type implies it, advances the
 * stage.
 *
 * The advance is one-directional and only ever forwards to the stage the
 * activity proves: sending a proposal means the deal is at least at
 * PROPOSAL_SENT. It never moves a deal backwards, so logging a follow-up call
 * on a deal in NEGOTIATION doesn't drag it back to CONTACTED.
 */
export async function logActivity(options: {
  leadId: string;
  userId: string;
  type: string;
  note: string;
  occurredAt?: Date;
}) {
  const occurredAt = options.occurredAt ?? new Date();

  const activity = await prisma.salesActivity.create({
    data: {
      leadId: options.leadId,
      userId: options.userId,
      type: options.type,
      note: options.note,
      occurredAt,
    },
  });

  const implied = IMPLIED_STAGE[options.type];
  if (implied) {
    const lead = await prisma.lead.findUnique({
      where: { id: options.leadId },
      select: { stage: true },
    });

    if (lead && isOpenStage(lead.stage)) {
      const current = OPEN_STAGES.indexOf(lead.stage as (typeof OPEN_STAGES)[number]);
      const target = OPEN_STAGES.indexOf(implied);
      if (target > current) {
        await prisma.lead.update({
          where: { id: options.leadId },
          data: { stage: implied, stageChangedAt: occurredAt },
        });
      }
    }
  }

  return activity;
}

/** What logging a given activity proves about where the deal has got to. */
const IMPLIED_STAGE: Record<string, (typeof OPEN_STAGES)[number] | undefined> = {
  CALL: "CONTACTED",
  EMAIL: "CONTACTED",
  DM: "CONTACTED",
  MEETING: "MEETING_BOOKED",
  PROPOSAL_SENT: "PROPOSAL_SENT",
  FOLLOW_UP: undefined,
};

// ---------------------------------------------------------------------------
// Weekly targets
// ---------------------------------------------------------------------------

export type WeekWindow = { start: Date; end: Date };

/** The agency week a moment falls in, as a half-open [start, end) window. */
export function weekWindow(reference: Date): WeekWindow {
  const start = startOfAgencyWeek(reference);
  const end = new Date(endOfAgencyWeek(reference).getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** Activity counts per bucket for one member in one week. */
export async function bucketCounts(
  userId: string,
  window: WeekWindow,
): Promise<Partial<Record<ActivityBucket, number>>> {
  const activities = await prisma.salesActivity.findMany({
    where: { userId, occurredAt: { gte: window.start, lt: window.end } },
    select: { type: true },
  });

  const counts: Partial<Record<ActivityBucket, number>> = {};
  for (const activity of activities) {
    const bucket = bucketFor(activity.type);
    if (!bucket) continue;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

/** A member's live progress against their targets, for the dashboard bar. */
export async function targetProgressFor(userId: string, now = new Date()) {
  const settings = await getSettings();
  const window = weekWindow(now);

  const [targets, counts] = await Promise.all([
    prisma.activityTarget.findMany({
      where: { userId, isActive: true },
      orderBy: { bucket: "asc" },
    }),
    bucketCounts(userId, window),
  ]);

  return {
    window,
    outcome: evaluateWeek(
      targets.map((row) => ({
        bucket: row.bucket as ActivityBucket,
        weeklyTarget: row.weeklyTarget,
      })),
      counts,
      targetConfig(settings),
    ),
  };
}

export function targetConfig(settings: {
  bonusTargetMet: number;
  penaltyTargetMissed: number;
  targetMissThreshold: number;
}): TargetConfig {
  return {
    bonusTargetMet: settings.bonusTargetMet,
    penaltyTargetMissed: settings.penaltyTargetMissed,
    missThreshold: settings.targetMissThreshold,
  };
}

export type WeeklyTargetRun = {
  evaluated: number;
  metCharged: number;
  missedCharged: number;
  pointsApplied: number;
};

/**
 * The Sunday-night pass: settle every member's targets for the week that has
 * just finished.
 *
 * Scoped to the *previous* week, so a run at 23:00 on Sunday and a catch-up
 * run on Monday morning both settle the same seven days. Every event carries a
 * dedupe key of `target:<user>:<bucket>:<weekStart>`, so running it ten times
 * charges once.
 */
export async function runWeeklyTargets(now = new Date()): Promise<WeeklyTargetRun> {
  const settings = await getSettings();
  const config = targetConfig(settings);

  // The week that just ended, not the one now starting.
  const lastWeek = weekWindow(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
  const weekKey = lastWeek.start.toISOString().slice(0, 10);

  const targets = await prisma.activityTarget.findMany({
    where: { isActive: true, weeklyTarget: { gt: 0 } },
    include: { user: { select: { id: true, name: true, isActive: true } } },
  });

  const byUser = new Map<string, typeof targets>();
  for (const target of targets) {
    if (!target.user.isActive) continue;
    byUser.set(target.userId, [...(byUser.get(target.userId) ?? []), target]);
  }

  let evaluated = 0;
  let metCharged = 0;
  let missedCharged = 0;
  let pointsApplied = 0;

  for (const [userId, userTargets] of byUser) {
    const counts = await bucketCounts(userId, lastWeek);
    const outcome = evaluateWeek(
      userTargets.map((row) => ({
        bucket: row.bucket as ActivityBucket,
        weeklyTarget: row.weeklyTarget,
      })),
      counts,
      config,
    );
    evaluated += 1;

    for (const progress of outcome.progress) {
      if (!progress.met && !progress.missed) continue;

      const applied = await applyEvents(
        [
          {
            userId,
            milestoneId: null,
            type: progress.met ? "TARGET_MET" : "TARGET_MISSED",
            points: progress.met
              ? Math.abs(settings.bonusTargetMet)
              : -Math.abs(settings.penaltyTargetMissed),
            reason: progress.met
              ? `Weekly ${progress.bucket.toLowerCase().replace("_", " ")} target met — ${progress.logged} of ${progress.target}.`
              : `Weekly ${progress.bucket.toLowerCase().replace("_", " ")} target missed — ${progress.logged} of ${progress.target}.`,
            dedupeKey: `target:${userId}:${progress.bucket}:${weekKey}`,
          },
        ],
        // Dated to the end of the week it describes, so it lands in that
        // week's month even when the job runs after midnight.
        { at: new Date(lastWeek.end.getTime() - 1000) },
      );

      if (applied > 0) {
        pointsApplied += applied;
        if (progress.met) metCharged += 1;
        else missedCharged += 1;
      }
    }
  }

  return { evaluated, metCharged, missedCharged, pointsApplied };
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export type PipelineMetrics = {
  stages: { stage: LeadStage; count: number; value: number }[];
  openValue: number;
  openCount: number;
  wonThisMonth: { count: number; value: number };
  lostThisMonth: { count: number; value: number };
  winRate: number | null;
  averageDealSize: number | null;
};

/**
 * The money numbers.
 *
 * Win rate is over *closed* deals — won divided by won plus lost — because
 * including the open pipeline in the denominator would make the rate fall
 * every time somebody adds a lead, which is precisely the behaviour you want
 * to encourage.
 */
export async function pipelineMetrics(now = new Date()): Promise<PipelineMetrics> {
  const cycle = agencyYearMonth(now);
  const monthStart = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  const monthEnd = new Date(Date.UTC(cycle.year, cycle.month, 1));

  const [leads, closedThisMonth, wonAllTime] = await Promise.all([
    prisma.lead.findMany({
      where: { stage: { in: [...OPEN_STAGES] } },
      select: { stage: true, estimatedMonthlyValue: true },
    }),
    prisma.lead.findMany({
      where: {
        stage: { in: ["WON", "LOST"] },
        stageChangedAt: { gte: monthStart, lt: monthEnd },
      },
      select: { stage: true, estimatedMonthlyValue: true },
    }),
    prisma.lead.findMany({
      where: { stage: "WON" },
      select: { estimatedMonthlyValue: true },
    }),
  ]);

  const stages = OPEN_STAGES.map((stage) => {
    const inStage = leads.filter((lead) => lead.stage === stage);
    return {
      stage: stage as LeadStage,
      count: inStage.length,
      value: inStage.reduce((sum, lead) => sum + lead.estimatedMonthlyValue, 0),
    };
  });

  const won = closedThisMonth.filter((lead) => lead.stage === "WON");
  const lost = closedThisMonth.filter((lead) => lead.stage === "LOST");
  const closed = won.length + lost.length;

  return {
    stages,
    openValue: stages.reduce((sum, entry) => sum + entry.value, 0),
    openCount: leads.length,
    wonThisMonth: {
      count: won.length,
      value: won.reduce((sum, lead) => sum + lead.estimatedMonthlyValue, 0),
    },
    lostThisMonth: {
      count: lost.length,
      value: lost.reduce((sum, lead) => sum + lead.estimatedMonthlyValue, 0),
    },
    winRate: closed === 0 ? null : Math.round((won.length / closed) * 100),
    averageDealSize:
      wonAllTime.length === 0
        ? null
        : Math.round(
            wonAllTime.reduce((sum, lead) => sum + lead.estimatedMonthlyValue, 0) /
              wonAllTime.length,
          ),
  };
}

export type MrrPoint = { year: number; month: number; amount: number; activeClients: number };

/**
 * MRR now, and the trend behind it.
 *
 * The current figure is computed live from active clients; the history comes
 * from snapshots, because a client who churns in March takes February's number
 * with them. Reconstructing it from today's data would quietly rewrite the
 * past every time the book of business changed.
 */
export async function mrrSeries(months = 6, now = new Date()) {
  const cycle = agencyYearMonth(now);

  const [activeClients, snapshots] = await Promise.all([
    prisma.client.findMany({
      where: { status: "ACTIVE" },
      select: { monthlyBudget: true },
    }),
    prisma.mrrSnapshot.findMany({
      orderBy: [{ year: "desc" }, { month: "desc" }],
      take: months,
    }),
  ]);

  const current = activeClients.reduce((sum, client) => sum + client.monthlyBudget, 0);

  // The current month reads live rather than from a snapshot taken at 2am, so
  // onboarding a client updates the headline immediately.
  const history: MrrPoint[] = snapshots
    .filter((row) => !(row.year === cycle.year && row.month === cycle.month))
    .map((row) => ({
      year: row.year,
      month: row.month,
      amount: row.amount,
      activeClients: row.activeClients,
    }))
    .reverse();

  const series = [
    ...history,
    { year: cycle.year, month: cycle.month, amount: current, activeClients: activeClients.length },
  ];

  const previous = series.length > 1 ? series[series.length - 2].amount : null;

  return {
    current,
    activeClients: activeClients.length,
    series,
    delta: previous === null ? null : current - previous,
    deltaPercent:
      previous === null || previous === 0
        ? null
        : Math.round(((current - previous) / previous) * 100),
  };
}

/** Records this month's MRR. Idempotent — one row per month, updated in place. */
export async function captureMrrSnapshot(now = new Date()) {
  const cycle = agencyYearMonth(now);
  const clients = await prisma.client.findMany({
    where: { status: "ACTIVE" },
    select: { monthlyBudget: true },
  });

  const amount = clients.reduce((sum, client) => sum + client.monthlyBudget, 0);

  await prisma.mrrSnapshot.upsert({
    where: { year_month: { year: cycle.year, month: cycle.month } },
    update: { amount, activeClients: clients.length, capturedAt: now },
    create: {
      year: cycle.year,
      month: cycle.month,
      amount,
      activeClients: clients.length,
      capturedAt: now,
    },
  });

  return { year: cycle.year, month: cycle.month, amount, activeClients: clients.length };
}

// ---------------------------------------------------------------------------
// Per-member BD summary, for reports and the hybrid profile
// ---------------------------------------------------------------------------

export type BusinessDevelopmentSummary = {
  activities: number;
  byBucket: { bucket: ActivityBucket; count: number }[];
  leadsWorked: number;
  stageConversion: { from: LeadStage; entered: number }[];
  dealsWon: number;
  revenueAdded: number;
  dealsLost: number;
  /** True when this person has any pipeline footprint at all. */
  active: boolean;
};

/**
 * What one member's business development looked like over a window.
 *
 * `active` is what decides whether the hybrid profile leads with pipeline or
 * with milestones — derived from the data rather than from a role flag, so a
 * delivery member who closes a referral gets credit without anyone changing a
 * setting.
 */
export async function businessDevelopmentSummary(
  userId: string,
  from: Date,
  to: Date,
): Promise<BusinessDevelopmentSummary> {
  const [activities, owned] = await Promise.all([
    prisma.salesActivity.findMany({
      where: { userId, occurredAt: { gte: from, lt: to } },
      select: { type: true, leadId: true },
    }),
    prisma.lead.findMany({
      where: { ownerId: userId },
      select: { stage: true, stageChangedAt: true, estimatedMonthlyValue: true },
    }),
  ]);

  const byBucket = new Map<ActivityBucket, number>();
  for (const activity of activities) {
    const bucket = bucketFor(activity.type);
    if (!bucket) continue;
    byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + 1);
  }

  const closedInWindow = owned.filter(
    (lead) => lead.stageChangedAt >= from && lead.stageChangedAt < to,
  );
  const won = closedInWindow.filter((lead) => lead.stage === "WON");
  const lost = closedInWindow.filter((lead) => lead.stage === "LOST");

  return {
    activities: activities.length,
    byBucket: [...byBucket].map(([bucket, count]) => ({ bucket, count })),
    leadsWorked: new Set(activities.map((activity) => activity.leadId)).size,
    // Where the pipeline stands now, by stage — the shape of what they're
    // carrying rather than a funnel of historical transitions, which would
    // need a stage-change log this doesn't keep.
    stageConversion: OPEN_STAGES.map((stage) => ({
      from: stage as LeadStage,
      entered: owned.filter((lead) => lead.stage === stage).length,
    })),
    dealsWon: won.length,
    revenueAdded: won.reduce((sum, lead) => sum + lead.estimatedMonthlyValue, 0),
    dealsLost: lost.length,
    active: activities.length > 0 || owned.length > 0,
  };
}

export { STAGE_LABEL };

async function admins() {
  return prisma.user.findMany({
    where: { role: "ADMIN", isActive: true },
    select: { id: true },
  });
}
