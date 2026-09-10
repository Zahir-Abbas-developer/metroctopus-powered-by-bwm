import { prisma } from "@/lib/prisma";
import { departmentIdsForUser } from "@/lib/departments";
import { companyTimezone } from "@/lib/company-time";
import { dueDeadline, startOfCompanyDay, toDateOnly } from "@/lib/date";
import type { TaskPriority, TaskStatus } from "@/lib/constants";

/**
 * Tasks and follow-ups — the daily working surface.
 *
 * Two things share this module because they answer the same question ("what do
 * I owe someone today?") and must group by the same clock:
 *
 * - **Tasks** are explicit: someone wrote "ring them back on Thursday".
 * - **Follow-ups** are implicit: a lead or client carries `nextFollowUpAt`, and
 *   when that date arrives the record itself is the thing owed.
 *
 * A follow-up is not written into the task table. Copying it would create two
 * records that disagree the moment one is edited, and there would be no answer
 * to which is right. It is projected into the same shape at read time instead.
 */

export type TaskBucket = "OVERDUE" | "TODAY" | "UPCOMING" | "COMPLETED";

export type TaskRow = {
  id: string;
  /** Distinguishes a real Task row from a projected follow-up. */
  kind: "TASK" | "FOLLOW_UP";
  title: string;
  note: string | null;
  dueAt: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  completedAt: string | null;
  bucket: TaskBucket;
  department: { id: string; shortLabel: string } | null;
  assignee: { id: string; name: string; avatarColor: string } | null;
  /** The lead or client this hangs off, for the link back. */
  record: { id: string; name: string; type: "LEAD" | "CLIENT" } | null;
};

export type TaskFilters = {
  departmentId?: string | null;
  assigneeId?: string | null;
  priority?: TaskPriority | null;
  /** Only what is owed by this user — the Today view's default. */
  mineOnly?: boolean;
};

/**
 * Which bucket a due date falls in, on the company clock.
 *
 * "Today" is a calendar day in the company timezone, not a 24-hour window from
 * now — a task due this evening is due today, and one due at 00:30 tomorrow is
 * not. Overdue is measured against `dueDeadline`, the end of the due day, so
 * nothing due today reads as late during the day it is due.
 */
export function bucketFor(
  dueAt: Date | null,
  now: Date,
  timeZone: string,
): Exclude<TaskBucket, "COMPLETED"> {
  // No date means it is waiting, not late. A task nobody dated is not a task
  // anybody is failing to do.
  if (!dueAt) return "UPCOMING";

  // Late is measured against the end of the due day on the company clock, so
  // nothing due today reads as overdue during the day it is due.
  if (now.getTime() > dueDeadline(dueAt, timeZone).getTime()) return "OVERDUE";

  // "Today" is a calendar day in the company's zone, not a rolling 24 hours: a
  // task due this evening is due today, one due at 00:30 tomorrow is not.
  return toDateOnly(dueAt).getTime() <= startOfCompanyDay(now, timeZone).getTime()
    ? "TODAY"
    : "UPCOMING";
}

/**
 * Everything owed, in buckets.
 *
 * Scoped by department: a member sees their departments' work and an admin sees
 * all of it, so this list cannot become a way to read another business line's
 * client names.
 */
export async function taskBoard(
  userId: string,
  isAdmin: boolean,
  filters: TaskFilters = {},
): Promise<{ rows: TaskRow[]; timeZone: string }> {
  const timeZone = await companyTimezone();
  const now = new Date();

  const allowed = await departmentIdsForUser(userId, isAdmin);
  if (allowed.length === 0) return { rows: [], timeZone };

  const departmentIds =
    filters.departmentId && allowed.includes(filters.departmentId)
      ? [filters.departmentId]
      : allowed;

  const assigneeId = filters.mineOnly ? userId : (filters.assigneeId ?? null);

  const [tasks, leads, clients] = await Promise.all([
    prisma.task.findMany({
      where: {
        departmentId: { in: departmentIds },
        ...(assigneeId ? { assigneeId } : {}),
        ...(filters.priority ? { priority: filters.priority } : {}),
      },
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
      include: {
        department: { select: { id: true, shortLabel: true } },
        assignee: { select: { id: true, name: true, avatarColor: true } },
        lead: { select: { id: true, businessName: true } },
        client: { select: { id: true, businessName: true } },
      },
    }),
    prisma.lead.findMany({
      where: {
        departmentId: { in: departmentIds },
        nextFollowUpAt: { not: null },
        convertedAt: null,
        ...(assigneeId ? { ownerId: assigneeId } : {}),
      },
      select: {
        id: true,
        businessName: true,
        nextFollowUpAt: true,
        department: { select: { id: true, shortLabel: true } },
        owner: { select: { id: true, name: true, avatarColor: true } },
      },
    }),
    prisma.client.findMany({
      where: {
        departmentId: { in: departmentIds },
        nextFollowUpAt: { not: null },
        ...(assigneeId ? { assigneeId } : {}),
      },
      select: {
        id: true,
        businessName: true,
        nextFollowUpAt: true,
        department: { select: { id: true, shortLabel: true } },
        assignee: { select: { id: true, name: true, avatarColor: true } },
      },
    }),
  ]);

  const rows: TaskRow[] = tasks.map((task) => ({
    id: task.id,
    kind: "TASK" as const,
    title: task.title,
    note: task.note,
    dueAt: task.dueAt?.toISOString() ?? null,
    priority: task.priority as TaskPriority,
    status: task.status as TaskStatus,
    completedAt: task.completedAt?.toISOString() ?? null,
    bucket:
      task.status === "DONE"
        ? ("COMPLETED" as const)
        : bucketFor(task.dueAt, now, timeZone),
    department: task.department,
    assignee: task.assignee,
    record: task.lead
      ? { id: task.lead.id, name: task.lead.businessName, type: "LEAD" as const }
      : task.client
        ? { id: task.client.id, name: task.client.businessName, type: "CLIENT" as const }
        : null,
  }));

  // Follow-ups are projected, never stored as tasks — a copy would disagree
  // with the record the moment either was edited.
  const followUps: TaskRow[] = [
    ...leads.map((lead) => ({
      id: `follow-up:lead:${lead.id}`,
      kind: "FOLLOW_UP" as const,
      title: `Follow up with ${lead.businessName}`,
      note: null,
      dueAt: lead.nextFollowUpAt!.toISOString(),
      priority: "MEDIUM" as TaskPriority,
      status: "OPEN" as TaskStatus,
      completedAt: null,
      bucket: bucketFor(lead.nextFollowUpAt, now, timeZone),
      department: lead.department,
      assignee: lead.owner,
      record: { id: lead.id, name: lead.businessName, type: "LEAD" as const },
    })),
    ...clients.map((client) => ({
      id: `follow-up:client:${client.id}`,
      kind: "FOLLOW_UP" as const,
      title: `Follow up with ${client.businessName}`,
      note: null,
      dueAt: client.nextFollowUpAt!.toISOString(),
      priority: "MEDIUM" as TaskPriority,
      status: "OPEN" as TaskStatus,
      completedAt: null,
      bucket: bucketFor(client.nextFollowUpAt, now, timeZone),
      department: client.department,
      assignee: client.assignee,
      record: { id: client.id, name: client.businessName, type: "CLIENT" as const },
    })),
  ];

  const all = [...rows, ...followUps];

  // Priority filter applies to real tasks only: a follow-up has no priority of
  // its own, and inventing one would let a filter hide work that exists.
  const filtered = filters.priority
    ? all.filter((row) => row.kind === "TASK" || row.priority === filters.priority)
    : all;

  filtered.sort((a, b) => {
    if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return a.title.localeCompare(b.title);
  });

  return { rows: filtered, timeZone };
}

/** Follow-ups that have come due and not yet been notified about today. */
export async function dueFollowUps(now: Date = new Date()) {
  const timeZone = await companyTimezone();

  const [leads, clients] = await Promise.all([
    prisma.lead.findMany({
      where: { nextFollowUpAt: { not: null }, convertedAt: null, ownerId: { not: null } },
      select: {
        id: true,
        businessName: true,
        nextFollowUpAt: true,
        ownerId: true,
        department: { select: { shortLabel: true } },
      },
    }),
    prisma.client.findMany({
      where: { nextFollowUpAt: { not: null }, assigneeId: { not: null } },
      select: {
        id: true,
        businessName: true,
        nextFollowUpAt: true,
        assigneeId: true,
        department: { select: { shortLabel: true } },
      },
    }),
  ]);

  const due = (at: Date | null) =>
    at !== null && bucketFor(at, now, timeZone) !== "UPCOMING";

  return [
    ...leads
      .filter((lead) => due(lead.nextFollowUpAt))
      .map((lead) => ({
        recordId: lead.id,
        type: "LEAD" as const,
        name: lead.businessName,
        userId: lead.ownerId!,
        department: lead.department.shortLabel,
        dueAt: lead.nextFollowUpAt!,
      })),
    ...clients
      .filter((client) => due(client.nextFollowUpAt))
      .map((client) => ({
        recordId: client.id,
        type: "CLIENT" as const,
        name: client.businessName,
        userId: client.assigneeId!,
        department: client.department.shortLabel,
        dueAt: client.nextFollowUpAt!,
      })),
  ];
}
