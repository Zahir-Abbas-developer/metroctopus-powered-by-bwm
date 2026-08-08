import { prisma } from "@/lib/prisma";
import { SERVICE_JOB_TITLES } from "@/lib/templates";
import {
  isoWeekKey,
  weekKeysFrom,
  weekLoad,
  suggestAssignee,
  type Candidate,
  type WeekLoad,
} from "@/lib/capacity";

/**
 * The database side of capacity planning.
 *
 * All the arithmetic is in lib/capacity.ts. This only gathers the hours.
 *
 * Load counts milestones that are still *live* — completed and missed work
 * doesn't occupy anyone's week. A member who finished everything early should
 * read as free, not as fully booked.
 */

const LIVE_STATUSES = ["PENDING", "IN_PROGRESS", "BLOCKED", "SUBMITTED"];

export type MemberLoad = {
  userId: string;
  name: string;
  jobTitle: string;
  avatarColor: string;
  capacityHours: number;
  weeks: WeekLoad[];
};

/**
 * Load per member per ISO week, for a run of consecutive weeks.
 *
 * One query for everybody rather than one per member: the utilization grid is
 * five people across eight weeks, and forty round trips to render a heat map
 * would be a strange way to spend a page load.
 */
export async function loadGrid(options: {
  from: Date;
  weeks: number;
  userIds?: string[];
}): Promise<MemberLoad[]> {
  const keys = weekKeysFrom(options.from, options.weeks);

  const members = await prisma.user.findMany({
    where: {
      isActive: true,
      role: "MEMBER",
      ...(options.userIds ? { id: { in: options.userIds } } : {}),
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      avatarColor: true,
      weeklyCapacityHours: true,
    },
  });

  const milestones = await prisma.milestone.findMany({
    where: {
      assigneeId: { in: members.map((member) => member.id) },
      status: { in: LIVE_STATUSES },
    },
    select: { assigneeId: true, dueDate: true, estimatedHours: true },
  });

  // week -> user -> { hours, count }
  const buckets = new Map<string, Map<string, { hours: number; count: number }>>();
  for (const milestone of milestones) {
    if (!milestone.assigneeId) continue;
    const key = isoWeekKey(milestone.dueDate);
    if (!keys.includes(key)) continue;

    const week = buckets.get(key) ?? new Map();
    const entry = week.get(milestone.assigneeId) ?? { hours: 0, count: 0 };
    entry.hours += milestone.estimatedHours;
    entry.count += 1;
    week.set(milestone.assigneeId, entry);
    buckets.set(key, week);
  }

  return members.map((member) => ({
    userId: member.id,
    name: member.name,
    jobTitle: member.jobTitle,
    avatarColor: member.avatarColor,
    capacityHours: member.weeklyCapacityHours,
    weeks: keys.map((key) => {
      const entry = buckets.get(key)?.get(member.id) ?? { hours: 0, count: 0 };
      return weekLoad(key, entry.hours, member.weeklyCapacityHours, entry.count);
    }),
  }));
}

/**
 * Everyone's load in the single week a piece of work is due, plus a
 * suggestion.
 *
 * This is what the assignment controls call. `serviceSlug` decides who counts
 * as qualified — matched against the same `SERVICE_JOB_TITLES` map the
 * planner's auto-assignment uses, so the suggestion and the default agree.
 */
export async function candidatesForWeek(options: {
  dueDate: Date;
  serviceSlug?: string | null;
  estimatedHours?: number;
  /** Excluded from their own load, so re-assigning to the same person is a no-op. */
  excludeMilestoneId?: string | null;
}) {
  const week = isoWeekKey(options.dueDate);
  const estimatedHours = options.estimatedHours ?? 2;

  const members = await prisma.user.findMany({
    where: { isActive: true, role: "MEMBER" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      jobTitle: true,
      avatarColor: true,
      weeklyCapacityHours: true,
    },
  });

  const milestones = await prisma.milestone.findMany({
    where: {
      assigneeId: { in: members.map((member) => member.id) },
      status: { in: LIVE_STATUSES },
      ...(options.excludeMilestoneId ? { id: { not: options.excludeMilestoneId } } : {}),
    },
    select: { assigneeId: true, dueDate: true, estimatedHours: true },
  });

  const hours = new Map<string, number>();
  for (const milestone of milestones) {
    if (!milestone.assigneeId) continue;
    if (isoWeekKey(milestone.dueDate) !== week) continue;
    hours.set(
      milestone.assigneeId,
      (hours.get(milestone.assigneeId) ?? 0) + milestone.estimatedHours,
    );
  }

  const qualifiedTitles = (
    options.serviceSlug ? (SERVICE_JOB_TITLES[options.serviceSlug] ?? []) : []
  ).map((title) => title.toLowerCase());

  const candidates: (Candidate & { avatarColor: string })[] = members.map((member) => {
    const used = hours.get(member.id) ?? 0;
    const load = weekLoad(week, used, member.weeklyCapacityHours, 0);

    return {
      userId: member.id,
      name: member.name,
      jobTitle: member.jobTitle,
      avatarColor: member.avatarColor,
      percent: load.percent,
      hours: used,
      capacityHours: member.weeklyCapacityHours,
      qualified: qualifiedTitles.includes(member.jobTitle.toLowerCase()),
    };
  });

  return {
    week,
    estimatedHours,
    candidates,
    suggestion: suggestAssignee(candidates, estimatedHours),
  };
}

/**
 * A member's load for a whole month, for the report line.
 *
 * Monthly rather than weekly here on purpose: a report is a summary, and
 * "31 hours across 12 milestones (78% of capacity)" is the sentence that
 * makes a score comparable. Capacity for the month is the weekly figure times
 * the number of weeks the month touches.
 */
export async function monthlyLoadFor(
  userId: string,
  from: Date,
  to: Date,
): Promise<{ hours: number; milestones: number; capacityHours: number; percent: number }> {
  const [member, milestones] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { weeklyCapacityHours: true },
    }),
    prisma.milestone.findMany({
      where: { assigneeId: userId, dueDate: { gte: from, lt: to } },
      select: { estimatedHours: true },
    }),
  ]);

  const hours = milestones.reduce((sum, milestone) => sum + milestone.estimatedHours, 0);
  const weeks = Math.max(1, (to.getTime() - from.getTime()) / (7 * 86_400_000));
  const capacityHours = Math.round((member?.weeklyCapacityHours ?? 40) * weeks);

  return {
    hours,
    milestones: milestones.length,
    capacityHours,
    percent: capacityHours <= 0 ? 0 : Math.round((hours / capacityHours) * 100),
  };
}
