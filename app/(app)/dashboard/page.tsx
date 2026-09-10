import type { Metadata } from "next";
import Link from "next/link";
import {
  PhoneCall,
  Briefcase,
  CalendarClock,
  CheckSquare,
  Gauge,
  ShieldAlert,
  Timer,
  TriangleAlert,
  Trophy,
  UserCheck,
  Wallet,
} from "lucide-react";

import { prisma } from "@/lib/prisma";
import { taskBoard } from "@/lib/tasks";
import { requireUser } from "@/lib/session";
import { currentCycle, scoresForCycle } from "@/lib/score-service";
import { monthlyScore } from "@/lib/scoring";
import {
  daysUntil,
  dueDeadline,
  formatDate,
  formatDateLong,
  greeting,
} from "@/lib/date";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { buttonClasses } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { ProgressBar } from "@/components/ui/ProgressBar";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { StatCard } from "@/components/ui/StatCard";
import { getModuleFlags } from "@/lib/modules";
import { WeightDots } from "@/components/ui/WeightDots";
import { RunEvaluationButton } from "@/components/dashboard/RunEvaluationButton";
import { ActivityFeed } from "@/components/dashboard/ActivityFeed";
import { AttendanceCard } from "@/components/attendance/AttendanceCard";
import { ReviewQueue } from "@/components/dashboard/ReviewQueue";
import { PushSetup } from "@/components/pwa/PushSetup";
import { PerformanceBadge, VolumeFootnote } from "@/components/ui/PerformanceBadge";
import { recentActivity } from "@/lib/activity";
import { karachiDay } from "@/lib/attendance-time";
import { performanceContext } from "@/lib/score-service";
import { mrrSeries, pipelineMetrics } from "@/lib/pipeline";
import { MrrCard } from "@/components/dashboard/MrrCard";
import { CollectionsCard } from "@/components/dashboard/CollectionsCard";
import { AtRiskClients } from "@/components/dashboard/AtRiskClients";
import { collections } from "@/lib/payments";
import { healthReport } from "@/lib/ops";
import { SystemHealth } from "@/components/dashboard/SystemHealth";
import { StreakCard } from "@/components/incentives/StreakCard";
import { monthlyScores, streakFor } from "@/lib/incentives-service";
import { getSettings } from "@/lib/settings";
import { clientsAtRisk } from "@/lib/client-health-service";
import { actorFor } from "@/lib/permissions-service";
import { TargetBar } from "@/components/pipeline/TargetBar";
import { formatMoney } from "@/lib/pipeline-types";
import { MILESTONE_STATUS_LABEL, MILESTONE_STATUS_TONE, type MilestoneStatus, hasAdminPower } from "@/lib/constants";

export const metadata: Metadata = {
  title: "Dashboard",
};

const OPEN_STATUSES = ["PENDING", "IN_PROGRESS", "SUBMITTED"];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: { denied?: string };
}) {
  const user = await requireUser();
  const isAdmin = hasAdminPower(user.role);
  // Doctrine 5: a parked module's cards must be absent, not empty. Each
  // section below is gated on its own module rather than on one blanket
  // flag, so switching one on brings back only its own surface.
  const flags = await getModuleFlags();
  // Who can hold a review queue: the owner, or a lead inside their own lines.
  const hasReviewQueue = isAdmin || (await actorFor(user)).leadServiceIds.length > 0;
  const firstName = (user.name ?? "there").split(" ")[0];
  const cycle = currentCycle();
  const now = new Date();

  // An admin sees the whole agency; a member sees only their own work.
  const scope = isAdmin ? {} : { assigneeId: user.id };

  // Read through taskBoard so this number and the page it links to are computed
  // by the same code on the same clock. A separate count here is how a
  // dashboard comes to disagree with the list behind it.
  const { rows: followUpRows } = await taskBoard(user.id, isAdmin, { mineOnly: !isAdmin });
  const pendingFollowUps = followUpRows.filter(
    (row) => row.kind === "FOLLOW_UP" && (row.bucket === "TODAY" || row.bucket === "OVERDUE"),
  ).length;

  const [activeClients, openMilestones, completed, members, atRisk] = await Promise.all([
    prisma.client.count({ where: { status: "ACTIVE" } }),
    prisma.milestone.count({ where: { ...scope, status: { in: OPEN_STATUSES } } }),
    prisma.milestone.findMany({
      where: { ...scope, status: "COMPLETED", completedAt: { not: null } },
      select: { dueDate: true, completedAt: true },
    }),
    prisma.user.findMany({
      where: { isActive: true, role: "MEMBER" },
      select: { id: true, name: true, jobTitle: true, avatarColor: true },
    }),
    prisma.milestone.findMany({
      where: {
        ...scope,
        status: { in: OPEN_STATUSES },
        // Anything due inside the next 48 hours, plus anything already past due.
        // Filtered exactly below — the deadline is the end of the due day in
        // agency time, which SQL can't express here.
        dueDate: { lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) },
      },
      orderBy: { dueDate: "asc" },
      take: 40,
      include: {
        assignee: { select: { id: true, name: true, avatarColor: true } },
        module: {
          select: {
            project: { select: { id: true, title: true, client: { select: { businessName: true } } } },
          },
        },
      },
    }),
  ]);

  // On-time rate over every approved milestone in scope, not just this month.
  const onTimeCount = completed.filter(
    (milestone) => milestone.completedAt! <= dueDeadline(milestone.dueDate),
  ).length;
  const onTimeRate =
    completed.length === 0 ? 0 : Math.round((onTimeCount / completed.length) * 100);

  // Owner-only: the feed spans everyone's work by definition.
  const activity = isAdmin ? await recentActivity(20) : [];

  // Today's attendance, read-only. Nothing is settled here — the member's own
  // poll and the daily job do the writing, so opening a dashboard can never
  // change somebody's score.
  const todayDays = isAdmin
    ? await prisma.attendanceDay.findMany({
        where: { date: karachiDay(now), user: { role: "MEMBER", isActive: true } },
        select: { clockInAt: true, clockOutAt: true },
      })
    : [];
  const presentToday = todayDays.filter((day) => day.clockInAt).length;
  const stillWorking = todayDays.filter((day) => day.clockInAt && !day.clockOutAt).length;

  // Money. The owner's dashboard leads with MRR because it is the number the
  // whole machine exists to grow — everything else on this page is a means to
  // moving it.
  const settings = await getSettings();

  // ADMIN_ONLY by default. Ranking five people against each other is a
  // different product, and not the one this is — so a member sees their own
  // numbers and their own trend, framed against their own past rather than
  // against four colleagues.
  const leaderboardVisible = isAdmin || settings.leaderboardVisibility === "TEAM_VISIBLE";

  const [mrr, pipeline, money, clientsNeedingAttention, health] = isAdmin
    ? await Promise.all([
        mrrSeries(6, now),
        pipelineMetrics(now),
        collections(now),
        clientsAtRisk(now, 5),
        healthReport(now),
      ])
    : [null, null, null, null, null];

  // A member's own streak — the one place the product shows someone something
  // they're working towards rather than something they might lose.
  const streak = isAdmin ? null : await streakFor(user.id, now);

  // Personal-best framing: last month's score and on-time rate, so a member is
  // measured against their own past rather than a five-person ranking.
  const ownHistory = isAdmin ? null : await monthlyScores(user.id, cycle, 4);

  const memberIds = members.map((member) => member.id);
  const scopedIds = leaderboardVisible ? memberIds : [user.id];
  const [scores, context] = await Promise.all([
    scoresForCycle(scopedIds, cycle),
    performanceContext(scopedIds, cycle, now),
  ]);

  const leaderboard = members
    .map((member) => {
      const figures = context.get(member.id);
      return {
        ...member,
        score: scores.get(member.id)?.score ?? monthlyScore([]),
        // Null rather than 0 when nothing has come due yet — an em dash is
        // honest, a red 0% is a false accusation.
        onTime: figures && figures.judged > 0 ? figures.onTimeRate : null,
        load: figures?.load ?? 0,
        totalWeight: figures?.totalWeight ?? 0,
      };
    })
    // Default sort is on-time rate, not score: the doctrine's whole point is
    // that the raw number is the least comparable of the three.
    .sort((a, b) => (b.onTime ?? -1) - (a.onTime ?? -1) || b.score - a.score);

  const avgScore =
    leaderboard.length === 0
      ? 0
      : Math.round(
          leaderboard.reduce((sum, member) => sum + member.score, 0) / leaderboard.length,
        );

  const ownScore = scores.get(user.id)?.score ?? monthlyScore([]);
  const ownContext = context.get(user.id);

  /**
   * A member's own trend, in words.
   *
   * Never a comparison to anyone else. The whole point of ADMIN_ONLY is that a
   * five-person ranking makes fourth place feel like failure when fourth of
   * five at 88 points is a good month — so the framing is always personal.
   */
  const personalBest = (() => {
    if (!ownHistory) return null;
    const active = ownHistory.filter((month) => month.active);
    if (active.length < 2) return null;

    const current = active[active.length - 1];
    const past = active.slice(0, -1);
    const best = Math.max(...past.map((month) => month.score));
    const previous = past[past.length - 1].score;

    if (current.score > best) return "Your best month yet — keep it there.";
    if (current.score > previous) {
      return `Up ${Math.round(current.score - previous)} points on last month.`;
    }
    if (current.score === previous) return "Holding steady on last month.";
    return null;
  })();

  // Only rows genuinely inside 48 hours or already late belong on "At risk".
  const atRiskAll = atRisk.filter((milestone) => {
    const deadline = dueDeadline(milestone.dueDate).getTime();
    return deadline - now.getTime() <= 48 * 60 * 60 * 1000;
  });
  // The badge counts everything at risk; the list shows the closest few and
  // says so, rather than quietly truncating.
  const atRiskRows = atRiskAll.slice(0, 8);

  return (
    <div className="space-y-8">
      {searchParams.denied === "admin" && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-card border border-warn/20 bg-warn-tint px-4 py-3 text-[13px] leading-relaxed text-warn"
        >
          <ShieldAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            That area is limited to the agency owner. You&rsquo;ve been returned
            to your dashboard.
          </span>
        </div>
      )}

      <PageHeader
        variant="dark"
        eyebrow={formatDateLong(now)}
        title={`${greeting()}, ${firstName}`}
        description={
          isAdmin
            ? "Where the agency stands today — delivery, deadlines and how the team is scoring."
            : "Your work at a glance, and how this month's score is tracking."
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <HeroStat label="Retainer cycle" value="Monthly" />
          <HeroStat label="Working timezone" value="Asia / Karachi" />
          <HeroStat label="Your role" value={isAdmin ? "Owner" : user.jobTitle} />
        </div>
      </PageHeader>

      {/* Small when healthy, loud when a job has quietly stopped. */}
      {isAdmin && health && <SystemHealth report={health} />}

      {/* Asked once, then never again. */}
      <PushSetup />

      {streak && (
        <StreakCard
          streak={streak}
          threshold={settings.bonusThresholdScore}
          bonusPercent={settings.defaultBonusPercent}
        />
      )}

      {/* The day itself, before anything about the month. */}
      {!isAdmin && flags.attendance && <AttendanceCard />}

      {/* Business development, for anyone with weekly targets. Renders
          nothing at all for a member who has none — no targets set is not
          this person's job, not an empty state. */}
      <TargetBar userId={user.id} />

      {/* The review queue sits above everything else on the page: work waiting
          on a decision is more urgent than a number describing last week.

          Only mounted for someone who can actually hold a queue. The component
          treats a 403 as "nothing to show", so mounting it for everyone looked
          harmless — but it made every member's dashboard fire a request the
          server was always going to refuse, and log a console error doing it.
          The server already knows who leads what; asking is cheaper than being
          told no. */}
      {hasReviewQueue && <ReviewQueue />}

      <section>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="font-display text-lg font-bold tracking-tight text-ink">
            {isAdmin ? "BWM at a glance" : "Your month"}
          </h2>
          {isAdmin && (flags.scoring || flags.attendance || flags.retainerProjects) && (
            <RunEvaluationButton />
          )}
        </div>

        <div
          className={`grid gap-4 sm:grid-cols-2 ${
            isAdmin ? "xl:grid-cols-4" : "xl:grid-cols-4"
          }`}
        >
          {/* MRR spans two columns and carries its own trend — it is the one
              figure where six months of shape says more than today's value. */}
          {isAdmin && flags.clientKpis && mrr && (
            <MrrCard
              current={mrr.current}
              activeClients={mrr.activeClients}
              delta={mrr.delta}
              deltaPercent={mrr.deltaPercent}
              series={mrr.series}
              collected={money?.collectedThisMonth ?? null}
              outstanding={money?.outstandingThisMonth ?? null}
            />
          )}
          {isAdmin && pipeline && (
            <StatCard
              label="Open pipeline"
              value={formatMoney(pipeline.openValue, true)}
              icon={Wallet}
              tone="info"
              hint={`${pipeline.openCount} live deal${pipeline.openCount === 1 ? "" : "s"}${
                pipeline.winRate !== null ? ` · ${pipeline.winRate}% win rate` : ""
              }`}
            />
          )}
          <StatCard
            label="Active clients"
            value={activeClients}
            icon={Briefcase}
            tone="info"
            hint="On a live monthly retainer"
          />
          {/* Core CRM, not a parked module — always shown. Links straight to
              the filtered list rather than to Tasks generally, so the number
              and the page behind it cannot disagree. */}
          <Link href="/tasks" className="rounded-card focus-visible:outline-none">
            <StatCard
              label="Pending follow-ups"
              value={pendingFollowUps}
              icon={PhoneCall}
              tone={pendingFollowUps === 0 ? "neutral" : "warning"}
              hint={isAdmin ? "Due today or overdue" : "Yours, due today or overdue"}
            />
          </Link>
          {flags.retainerProjects && (
          <StatCard
            label="Open milestones"
            value={openMilestones}
            icon={CheckSquare}
            tone={openMilestones === 0 ? "neutral" : "warning"}
            hint={isAdmin ? "Across every engagement" : "Assigned to you"}
          />
          )}
          {flags.retainerProjects && (
          <StatCard
            label="On-time rate"
            value={onTimeRate}
            unit="%"
            icon={Timer}
            tone={
              completed.length === 0
                ? "neutral"
                : onTimeRate >= 90
                  ? "success"
                  : onTimeRate >= 70
                    ? "warning"
                    : "danger"
            }
            // All-time, unlike the per-member rate on a profile, which is
            // scoped to the cycle its score belongs to.
            hint={`${onTimeCount} of ${completed.length} approved by deadline, all time`}
          />
          )}
          {flags.scoring && (
          <StatCard
            label={isAdmin ? "Avg team score" : "Your score"}
            value={isAdmin ? avgScore : ownScore}
            unit="pts"
            icon={Gauge}
            tone={
              (isAdmin ? avgScore : ownScore) >= 90
                ? "success"
                : (isAdmin ? avgScore : ownScore) >= 75
                  ? "info"
                  : "warning"
            }
            hint="Starts at 100 each month"
          />
          )}
          {isAdmin && flags.attendance && (
            <StatCard
              label="Team present today"
              value={presentToday}
              icon={UserCheck}
              tone={
                members.length === 0
                  ? "neutral"
                  : presentToday === members.length
                    ? "success"
                    : presentToday === 0
                      ? "danger"
                      : "warning"
              }
              hint={
                presentToday === 0
                  ? `Nobody of ${members.length} has clocked in`
                  : stillWorking === presentToday
                    ? `of ${members.length} · all still working`
                    : `of ${members.length} · ${stillWorking} still working`
              }
            />
          )}
        </div>
      </section>

      {(flags.retainerProjects || flags.scoring) && (
      <section className="grid gap-5 lg:grid-cols-2">
        {/* At risk — milestone deadlines, so it belongs to retainer projects */}
        {flags.retainerProjects && (
        <Card padded={false}>
          <CardHeader
            title="At risk"
            description="Due within 48 hours, or already past deadline"
            action={
              atRiskAll.length > 0 ? (
                <Badge tone="danger">{atRiskAll.length}</Badge>
              ) : undefined
            }
          />

          {atRiskRows.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              eyebrow="All clear"
              title="Nothing at risk"
              description={
                isAdmin
                  ? "No milestone is inside its final 48 hours or past its deadline right now."
                  : "None of your milestones are close to their deadline."
              }
            />
          ) : (
            <ul className="divide-y divide-line">
              {atRiskRows.map((milestone) => {
                const overdue = dueDeadline(milestone.dueDate) < now;
                const days = daysUntil(dueDeadline(milestone.dueDate), now);

                return (
                  <li key={milestone.id} className="flex items-start gap-3 px-5 py-3.5">
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] border ${
                        overdue
                          ? "border-danger/20 bg-danger-tint text-danger"
                          : "border-warn/20 bg-warn-tint text-warn"
                      }`}
                    >
                      <TriangleAlert className="h-4 w-4" />
                    </span>

                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/projects/${milestone.module.project.id}`}
                        className="text-sm font-medium text-ink hover:text-brand"
                      >
                        {milestone.title}
                      </Link>
                      <p className="mt-0.5 truncate text-[12px] text-ink/45">
                        {milestone.module.project.client.businessName} ·{" "}
                        {formatDate(milestone.dueDate)} · {lateness(overdue, days)}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <WeightDots weight={milestone.weight} />
                      {milestone.assignee ? (
                        <Avatar
                          name={milestone.assignee.name}
                          color={milestone.assignee.avatarColor}
                          size="sm"
                        />
                      ) : (
                        <Badge size="sm" tone="neutral">
                          Unassigned
                        </Badge>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {atRiskAll.length > atRiskRows.length && (
            <p className="border-t border-line px-5 py-3 text-[12px] text-ink/40">
              Showing the {atRiskRows.length} closest of {atRiskAll.length}.
            </p>
          )}
        </Card>
        )}

        {/* Leaderboard (owner) or personal standing (member) */}
        {flags.scoring && leaderboardVisible ? (
          <Card padded={false}>
            <CardHeader
              title="Team performance"
              description="This month's scores, best to lowest"
              action={
                <Link href="/team" className={buttonClasses("ghost", "sm")}>
                  All members
                </Link>
              }
            />

            {leaderboard.length === 0 ? (
              <EmptyState
                icon={Trophy}
                eyebrow="No team yet"
                title="Nobody to rank"
                description="Add team members and their scores will be tracked here every month."
              />
            ) : (
              <ul className="divide-y divide-line">
                {leaderboard.map((member, index) => (
                  <li key={member.id}>
                    <Link
                      href={`/team/${member.id}`}
                      className="flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-cream/50"
                    >
                      <span className="w-4 shrink-0 font-display text-sm font-bold tabular-nums text-ink/30">
                        {index + 1}
                      </span>
                      <Avatar name={member.name} color={member.avatarColor} size="sm" />

                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{member.name}</p>
                        <p className="truncate text-[12px] text-ink/45">{member.jobTitle}</p>
                      </div>

                      {/* The triple, never the raw score alone. */}
                      <PerformanceBadge
                        align="end"
                        size="sm"
                        figures={{
                          score: member.score,
                          onTimeRate: member.onTime,
                          load: member.load,
                        }}
                      />
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {leaderboard.length > 0 && (
              <div className="border-t border-line px-5 py-3">
                <VolumeFootnote />
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <h3 className="font-display text-base font-bold tracking-tight text-ink">
              Your standing
            </h3>
            <p className="mt-1 text-[13px] text-ink/50">
              This month&rsquo;s deadlines, judged on when you submitted.
            </p>

            {personalBest && (
              <p className="mt-3 rounded-[10px] border border-brand/20 bg-brand-tint px-3 py-2 text-[13px] leading-relaxed text-brand">
                {personalBest}
              </p>
            )}

            <div className="mt-6 flex items-center gap-6">
              <ScoreRing score={ownScore} size="md" showLabel />
              <div className="min-w-0 flex-1 space-y-4">
                <ProgressBar
                  value={ownContext?.onTimeRate ?? 0}
                  label={`On-time rate · ${ownContext?.load ?? 0} ${
                    (ownContext?.load ?? 0) === 1 ? "task" : "tasks"
                  } this month`}
                  showValue
                />
                <p className="text-[13px] leading-relaxed text-ink/55">
                  Every month starts at 100, and the clock stops when you hand
                  work in — not when it&rsquo;s approved.
                </p>
                <Link href="/my-performance" className={buttonClasses("secondary", "sm")}>
                  See what changed it
                </Link>
              </div>
            </div>
          </Card>
        )}
      </section>
      )}

      {/* Money and risk, side by side: what hasn't arrived, and who might
          stop sending it. */}
      {isAdmin && flags.clientKpis && money && clientsNeedingAttention && (
        <section className="grid gap-5 lg:grid-cols-2">
          <CollectionsCard collections={money} />
          <AtRiskClients
            rows={clientsNeedingAttention.map((row) => ({
              clientId: row.clientId,
              clientName: row.clientName,
              score: row.score,
              band: row.band,
              headline: row.headline,
            }))}
          />
        </section>
      )}

      {/* Workspace activity */}
      {isAdmin && (
        <Card padded={false}>
          <CardHeader
            title="Activity"
            description="The last 20 things that happened across the workspace"
            action={
              // The board is the retainer-projects surface. With the module
              // parked this must not render: a link into a disabled feature is
              // the same defect as a nav item for one.
              flags.retainerProjects ? (
                <Link href="/board" className={buttonClasses("ghost", "sm")}>
                  Open the board
                </Link>
              ) : undefined
            }
          />
          <ActivityFeed activity={activity} />
        </Card>
      )}

      {/* Member's next deadlines */}
      {!isAdmin && flags.retainerProjects && atRiskRows.length === 0 && (
        <Card padded={false}>
          <CardHeader title="Next up" description="Your closest deadlines" />
          <MemberUpcoming userId={user.id} />
        </Card>
      )}
    </div>
  );
}

async function MemberUpcoming({ userId }: { userId: string }) {
  const upcoming = await prisma.milestone.findMany({
    where: { assigneeId: userId, status: { in: OPEN_STATUSES } },
    orderBy: { dueDate: "asc" },
    take: 5,
    include: {
      module: { select: { project: { select: { client: { select: { businessName: true } } } } } },
    },
  });

  if (upcoming.length === 0) {
    return (
      <EmptyState
        icon={CalendarClock}
        eyebrow="Nothing scheduled"
        title="No open milestones"
        description="When the owner plans this month's work, your milestones will appear here."
      />
    );
  }

  return (
    <ul className="divide-y divide-line">
      {upcoming.map((milestone) => (
        <li key={milestone.id} className="flex items-center gap-3 px-5 py-3.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">{milestone.title}</p>
            <p className="truncate text-[12px] text-ink/45">
              {milestone.module.project.client.businessName} ·{" "}
              {formatDate(milestone.dueDate)}
            </p>
          </div>
          <Badge size="sm" dot tone={MILESTONE_STATUS_TONE[milestone.status as MilestoneStatus]}>
            {MILESTONE_STATUS_LABEL[milestone.status as MilestoneStatus]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

/** "0 days overdue" is nonsense — inside the first day it's overdue today. */
function lateness(overdue: boolean, days: number): string {
  if (!overdue) return "due within 48h";
  const late = Math.abs(days);
  if (late === 0) return "overdue today";
  return `${late} day${late === 1 ? "" : "s"} overdue`;
}

function HeroStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[10px] border border-paper/10 bg-paper/[0.04] px-4 py-3">
      <p className="eyebrow text-paper/35">{label}</p>
      <p className="mt-1.5 text-sm font-medium text-paper/85">{value}</p>
    </div>
  );
}
