import { prisma } from "@/lib/prisma";
import { departmentScope, isOwner, type Viewer } from "@/lib/visibility";
import { stagesFor } from "@/lib/stages";
import { companyTimezone } from "@/lib/company-time";
import { DAY_MS, startOfCompanyDay, toDateOnly } from "@/lib/date";
import { WINNING_STAGE_KINDS } from "@/lib/constants";

/**
 * The dashboard's numbers.
 *
 * Two rules hold everything here together.
 *
 * **Every figure is a query.** Doctrine 4 forbids a hardcoded stat, and the way
 * to keep that true is for the dashboard to own no arithmetic of its own: it
 * renders what this module returns.
 *
 * **Every figure is scoped.** An aggregate is a disclosure like any other — a
 * member who cannot open a Pilot Cars lead must not be able to read its value
 * out of a total either. Scoping is applied once, in `metricsFor`, and every
 * count below is derived from the same filtered sets rather than from its own
 * unscoped query.
 *
 * What a stage *means* is read from each department's own `PipelineStage` rows,
 * never string-matched: "won" is a kind, and the four departments spell it
 * Completed, Converted, Active and Won.
 */

// ---------------------------------------------------------------------------
// Ranges — pure, so they can be tested without a database
// ---------------------------------------------------------------------------

export const RANGE_PRESETS = [
  "THIS_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "ALL_TIME",
  "CUSTOM",
] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

export const RANGE_LABEL: Record<RangePreset, string> = {
  THIS_WEEK: "This week",
  THIS_MONTH: "This month",
  LAST_MONTH: "Last month",
  ALL_TIME: "All time",
  CUSTOM: "Custom",
};

export type DateRange = { from: Date | null; to: Date | null };

/**
 * A preset resolved against a calendar day in the company's zone.
 *
 * `to` is exclusive — the instant the range stops, not the last one inside it.
 * An inclusive end has to be "23:59:59.999", which silently drops anything in
 * the final millisecond and reads as correct while being wrong.
 *
 * The week starts on Monday: the company's own week does, and a dashboard whose
 * "this week" disagrees with the team's is worse than one with no range at all.
 */
export function resolveRange(
  preset: RangePreset,
  today: Date,
  custom?: { from?: string | null; to?: string | null },
): DateRange {
  const startOfToday = toDateOnly(today);

  switch (preset) {
    case "THIS_WEEK": {
      // getUTCDay: 0 is Sunday. Shift so Monday is 0.
      const weekday = (startOfToday.getUTCDay() + 6) % 7;
      const from = new Date(startOfToday.getTime() - weekday * DAY_MS);
      return { from, to: new Date(from.getTime() + 7 * DAY_MS) };
    }
    case "THIS_MONTH": {
      const from = new Date(
        Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth(), 1),
      );
      const to = new Date(
        Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth() + 1, 1),
      );
      return { from, to };
    }
    case "LAST_MONTH": {
      const from = new Date(
        Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth() - 1, 1),
      );
      const to = new Date(
        Date.UTC(startOfToday.getUTCFullYear(), startOfToday.getUTCMonth(), 1),
      );
      return { from, to };
    }
    case "CUSTOM": {
      const from = custom?.from ? toDateOnly(new Date(custom.from)) : null;
      // An inclusive-looking custom end is made exclusive by adding a day, so
      // "1st to 5th" includes the 5th rather than stopping at its midnight.
      const to = custom?.to
        ? new Date(toDateOnly(new Date(custom.to)).getTime() + DAY_MS)
        : null;
      return {
        from: from && !Number.isNaN(from.getTime()) ? from : null,
        to: to && !Number.isNaN(to.getTime()) ? to : null,
      };
    }
    case "ALL_TIME":
    default:
      return { from: null, to: null };
  }
}

/** A Prisma filter for a range, or nothing when the range is open. */
export function rangeFilter(range: DateRange): { gte?: Date; lt?: Date } | undefined {
  if (!range.from && !range.to) return undefined;
  return {
    ...(range.from ? { gte: range.from } : {}),
    ...(range.to ? { lt: range.to } : {}),
  };
}

/**
 * Won as a share of everything that closed.
 *
 * Open deals are excluded from the denominator on purpose: a pipeline full of
 * live work would otherwise read as a collapsing conversion rate, and the
 * number would fall every time somebody added a lead.
 *
 * Returns null rather than 0 when nothing has closed — "no data" and "lost
 * everything" are different, and 0% says the second.
 */
export function conversionRate(won: number, lost: number): number | null {
  const closed = won + lost;
  if (closed === 0) return null;
  return Math.round((won / closed) * 100);
}

// ---------------------------------------------------------------------------
// The metric set
// ---------------------------------------------------------------------------

export type AnalyticsFilters = {
  departmentId?: string | null;
  memberId?: string | null;
  preset?: RangePreset;
  from?: string | null;
  to?: string | null;
};

export type DepartmentRow = {
  departmentId: string;
  shortLabel: string;
  leads: number;
  won: number;
  lost: number;
  conversionRate: number | null;
  revenue: number;
};

export type MemberRow = {
  userId: string;
  name: string;
  avatarColor: string;
  leads: number;
  won: number;
  conversionRate: number | null;
  activities: number;
};

export type Analytics = {
  range: { from: string | null; to: string | null; preset: RangePreset };
  departments: { id: string; shortLabel: string }[];
  totals: {
    totalLeads: number;
    newLeads: number;
    activeClients: number;
    convertedClients: number;
    openDeals: { count: number; value: number };
    wonDeals: { count: number; value: number };
    lostDeals: number;
    revenue: number;
    pendingFollowUps: number;
    openTasks: number;
    overdueTasks: number;
    conversionRate: number | null;
  };
  byDepartment: DepartmentRow[];
  byMember: MemberRow[];
  charts: {
    leadsOverTime: { date: string; leads: number }[];
    revenueByDepartment: { department: string; revenue: number }[];
    pipelineByStage: { stage: string; count: number; value: number }[];
  };
};

export async function metricsFor(
  viewer: Viewer,
  filters: AnalyticsFilters = {},
  now: Date = new Date(),
): Promise<Analytics> {
  const preset = filters.preset ?? "THIS_MONTH";
  const range = resolveRange(preset, now, { from: filters.from, to: filters.to });
  const created = rangeFilter(range);

  const scope = departmentScope(viewer);

  // A department filter can only ever narrow what the viewer may already see.
  // Trusting the parameter on its own would turn a query string into a
  // permission.
  const permitted = isOwner(viewer)
    ? await prisma.department.findMany({
        where: { isActive: true },
        orderBy: { order: "asc" },
        select: { id: true, shortLabel: true },
      })
    : await prisma.department.findMany({
        where: { isActive: true, id: { in: [...viewer.departmentIds] } },
        orderBy: { order: "asc" },
        select: { id: true, shortLabel: true },
      });

  const focusIds =
    filters.departmentId && permitted.some((row) => row.id === filters.departmentId)
      ? [filters.departmentId]
      : permitted.map((row) => row.id);

  const departmentWhere = { departmentId: { in: focusIds } };
  const ownerWhere = filters.memberId ? { ownerId: filters.memberId } : {};

  if (focusIds.length === 0) {
    return emptyAnalytics(preset, range);
  }

  // Stage meaning per department, so "won" is never a string comparison.
  const stageSets = await Promise.all(focusIds.map((id) => stagesFor(id)));
  const wonKeys = new Set<string>();
  const lostKeys = new Set<string>();
  const openKeys = new Set<string>();
  const stageLabels = new Map<string, string>();

  stageSets.flat().forEach((stage) => {
    stageLabels.set(stage.key, stage.label);
    if (WINNING_STAGE_KINDS.includes(stage.kind)) wonKeys.add(stage.key);
    else if (stage.kind === "LOST") lostKeys.add(stage.key);
    else openKeys.add(stage.key);
  });

  const [allLeads, clients, tasks, activities] = await Promise.all([
    prisma.lead.findMany({
      where: { ...scope, ...departmentWhere, ...ownerWhere },
      select: {
        id: true,
        departmentId: true,
        stage: true,
        dealValue: true,
        createdAt: true,
        stageChangedAt: true,
        nextFollowUpAt: true,
        convertedAt: true,
        ownerId: true,
        owner: { select: { id: true, name: true, avatarColor: true } },
      },
    }),
    prisma.client.findMany({
      where: {
        ...scope,
        ...departmentWhere,
        ...(filters.memberId ? { assigneeId: filters.memberId } : {}),
      },
      select: { id: true, status: true, nextFollowUpAt: true, createdAt: true },
    }),
    prisma.task.findMany({
      where: {
        ...scope,
        ...departmentWhere,
        ...(filters.memberId ? { assigneeId: filters.memberId } : {}),
      },
      select: { id: true, status: true, dueAt: true },
    }),
    prisma.salesActivity.findMany({
      where: {
        ...scope,
        ...departmentWhere,
        isSystem: false,
        ...(created ? { occurredAt: created } : {}),
      },
      select: { userId: true },
    }),
  ]);

  const inRange = (at: Date | null) => {
    if (!created || !at) return !created;
    if (created.gte && at < created.gte) return false;
    if (created.lt && at >= created.lt) return false;
    return true;
  };

  const won = allLeads.filter((lead) => wonKeys.has(lead.stage));
  const lost = allLeads.filter((lead) => lostKeys.has(lead.stage));
  const open = allLeads.filter((lead) => openKeys.has(lead.stage));

  // Revenue counts deals that *landed* in the range, dated by the stage move
  // rather than by creation — a deal created in March and won in June is June's
  // revenue, and dating it by creation would credit the wrong month.
  const wonInRange = won.filter((lead) => inRange(lead.stageChangedAt));

  // "Today" for overdue and due-now counts is the company's calendar day, not
  // the server's — the same rule the tasks board groups by, so the dashboard
  // count and the list it links to cannot disagree.
  const todayStart = startOfCompanyDay(now, await companyTimezone());

  const overdueTasks = tasks.filter(
    (task) => task.status === "OPEN" && task.dueAt && toDateOnly(task.dueAt) < todayStart,
  ).length;

  const pendingFollowUps =
    allLeads.filter(
      (lead) =>
        lead.nextFollowUpAt !== null &&
        lead.convertedAt === null &&
        toDateOnly(lead.nextFollowUpAt) <= todayStart,
    ).length +
    clients.filter(
      (client) =>
        client.nextFollowUpAt !== null && toDateOnly(client.nextFollowUpAt) <= todayStart,
    ).length;

  const labelFor = new Map(permitted.map((row) => [row.id, row.shortLabel]));

  const byDepartment: DepartmentRow[] = focusIds.map((id) => {
    const mine = allLeads.filter((lead) => lead.departmentId === id);
    const w = mine.filter((lead) => wonKeys.has(lead.stage));
    const l = mine.filter((lead) => lostKeys.has(lead.stage));
    return {
      departmentId: id,
      shortLabel: labelFor.get(id) ?? "—",
      leads: mine.length,
      won: w.length,
      lost: l.length,
      conversionRate: conversionRate(w.length, l.length),
      revenue: w
        .filter((lead) => inRange(lead.stageChangedAt))
        .reduce((sum, lead) => sum + lead.dealValue, 0),
    };
  });

  const activityByUser = new Map<string, number>();
  for (const activity of activities) {
    activityByUser.set(activity.userId, (activityByUser.get(activity.userId) ?? 0) + 1);
  }

  const memberIds = new Set<string>();
  for (const lead of allLeads) if (lead.ownerId) memberIds.add(lead.ownerId);
  for (const id of activityByUser.keys()) memberIds.add(id);

  const memberRows = await prisma.user.findMany({
    where: { id: { in: [...memberIds] } },
    select: { id: true, name: true, avatarColor: true },
  });

  const byMember: MemberRow[] = memberRows
    .map((member) => {
      const mine = allLeads.filter((lead) => lead.ownerId === member.id);
      const w = mine.filter((lead) => wonKeys.has(lead.stage));
      const l = mine.filter((lead) => lostKeys.has(lead.stage));
      return {
        userId: member.id,
        name: member.name,
        avatarColor: member.avatarColor,
        leads: mine.length,
        won: w.length,
        conversionRate: conversionRate(w.length, l.length),
        activities: activityByUser.get(member.id) ?? 0,
      };
    })
    .sort((a, b) => b.won - a.won || b.leads - a.leads || a.name.localeCompare(b.name));

  return {
    range: {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      preset,
    },
    departments: permitted.map((row) => ({ id: row.id, shortLabel: row.shortLabel })),
    totals: {
      totalLeads: allLeads.length,
      newLeads: allLeads.filter((lead) => inRange(lead.createdAt)).length,
      activeClients: clients.filter((client) => client.status === "ACTIVE").length,
      convertedClients: allLeads.filter((lead) => lead.convertedAt !== null).length,
      openDeals: {
        count: open.length,
        value: open.reduce((sum, lead) => sum + lead.dealValue, 0),
      },
      wonDeals: {
        count: won.length,
        value: won.reduce((sum, lead) => sum + lead.dealValue, 0),
      },
      lostDeals: lost.length,
      revenue: wonInRange.reduce((sum, lead) => sum + lead.dealValue, 0),
      pendingFollowUps,
      openTasks: tasks.filter((task) => task.status === "OPEN").length,
      overdueTasks,
      conversionRate: conversionRate(won.length, lost.length),
    },
    byDepartment,
    byMember,
    charts: {
      leadsOverTime: leadsOverTime(allLeads, range, now),
      revenueByDepartment: byDepartment.map((row) => ({
        department: row.shortLabel,
        revenue: row.revenue,
      })),
      pipelineByStage: [...openKeys].map((key) => {
        const inStage = allLeads.filter((lead) => lead.stage === key);
        return {
          stage: stageLabels.get(key) ?? key,
          count: inStage.length,
          value: inStage.reduce((sum, lead) => sum + lead.dealValue, 0),
        };
      }),
    },
  };
}

/**
 * Leads per day across the range.
 *
 * Capped at 90 buckets: a year-long custom range would otherwise produce 365
 * points on a chart a few hundred pixels wide, which is a smear rather than a
 * trend. Beyond the cap the range is bucketed weekly.
 */
function leadsOverTime(
  leads: readonly { createdAt: Date }[],
  range: DateRange,
  now: Date,
): { date: string; leads: number }[] {
  const from = range.from ?? earliest(leads) ?? toDateOnly(now);
  const to = range.to ?? new Date(toDateOnly(now).getTime() + DAY_MS);

  const days = Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
  const bucketDays = days > 90 ? 7 : 1;
  const buckets = Math.ceil(days / bucketDays);

  const counts = new Array(buckets).fill(0);
  for (const lead of leads) {
    const offset = Math.floor(
      (toDateOnly(lead.createdAt).getTime() - from.getTime()) / (DAY_MS * bucketDays),
    );
    if (offset >= 0 && offset < buckets) counts[offset] += 1;
  }

  return counts.map((count, index) => ({
    date: new Date(from.getTime() + index * bucketDays * DAY_MS)
      .toISOString()
      .slice(0, 10),
    leads: count,
  }));
}

function earliest(leads: readonly { createdAt: Date }[]): Date | null {
  if (leads.length === 0) return null;
  return toDateOnly(
    leads.reduce((min, lead) => (lead.createdAt < min ? lead.createdAt : min), leads[0].createdAt),
  );
}

function emptyAnalytics(preset: RangePreset, range: DateRange): Analytics {
  return {
    range: {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      preset,
    },
    departments: [],
    totals: {
      totalLeads: 0,
      newLeads: 0,
      activeClients: 0,
      convertedClients: 0,
      openDeals: { count: 0, value: 0 },
      wonDeals: { count: 0, value: 0 },
      lostDeals: 0,
      revenue: 0,
      pendingFollowUps: 0,
      openTasks: 0,
      overdueTasks: 0,
      conversionRate: null,
    },
    byDepartment: [],
    byMember: [],
    charts: { leadsOverTime: [], revenueByDepartment: [], pipelineByStage: [] },
  };
}
