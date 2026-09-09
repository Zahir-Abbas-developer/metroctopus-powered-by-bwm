import { prisma } from "@/lib/prisma";
import { parseSkills } from "@/lib/skills";
import type { DeptRole } from "@/lib/constants";

/**
 * Who can be assigned a record, and who should be.
 *
 * Two rules, and the first one is a permission rather than a convenience:
 *
 * 1. **Only that department's members may be offered.** A dropdown listing
 *    someone outside the department is not a cosmetic bug — it hands the caller
 *    a user id that would put a record in front of a person who cannot see the
 *    department, and it leaks the roster of a department they are not in.
 * 2. **Best fit floats to the top.** Ranking is a hint, never a filter: every
 *    member of the department stays selectable, because the person who knows
 *    why this lead is different outranks any scoring here.
 */

export type AssignableMember = {
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  roleInDept: DeptRole;
  skills: string[];
  /** Skills that matched the supplied context — why this row is recommended. */
  matchedSkills: string[];
  /** Live count of leads they own that are neither won nor lost. */
  openLeads: number;
  recommended: boolean;
};

/**
 * Terms describing the work, matched against member skills.
 *
 * The department's own slug and short label are always included, so a department
 * with no category context still ranks the people whose skills name it.
 */
function contextTerms(
  department: { slug: string; shortLabel: string; name: string },
  extra: readonly string[],
): string[] {
  const raw = [
    department.slug,
    department.shortLabel,
    department.name,
    ...extra,
  ].join(" ");

  return Array.from(
    new Set(
      raw
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2),
    ),
  );
}

/**
 * A skill counts as matched when it shares a whole word with the context.
 *
 * Substring matching was the obvious first cut and is wrong: "sales" appears
 * inside no other skill here, but "cam" is a substring of "campaign", and
 * Culture Plus's "Cam" category matching a campaign skill is precisely the
 * conflation CLAUDE.md calls out by name.
 */
function skillMatches(skill: string, terms: readonly string[]): boolean {
  const words = skill.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => terms.includes(word));
}

/**
 * Members of one department, ranked for assignment.
 *
 * `context` is free text describing the work — the selected category, service
 * interest, or anything else the form knows at assignment time.
 */
export async function assignableMembers(
  departmentId: string,
  context: readonly string[] = [],
): Promise<AssignableMember[]> {
  const department = await prisma.department.findUnique({
    where: { id: departmentId },
    select: { id: true, slug: true, shortLabel: true, name: true },
  });
  if (!department) return [];

  const memberships = await prisma.departmentMembership.findMany({
    where: { departmentId, user: { isActive: true } },
    include: {
      user: { select: { id: true, name: true, email: true, avatarColor: true } },
    },
  });
  if (memberships.length === 0) return [];

  // One grouped query rather than one per member: the count is shown next to
  // every name, so a per-row query would scale with the size of the department.
  const openByOwner = await prisma.lead.groupBy({
    by: ["ownerId"],
    where: {
      departmentId,
      ownerId: { in: memberships.map((m) => m.userId) },
      convertedAt: null,
      stage: { notIn: await terminalStages(departmentId) },
    },
    _count: { _all: true },
  });

  const openCount = new Map(
    openByOwner.map((row) => [row.ownerId ?? "", row._count._all]),
  );

  const terms = contextTerms(department, context);

  const rows: AssignableMember[] = memberships.map((membership) => {
    const skills = parseSkills(membership.skills);
    const matchedSkills = skills.filter((skill) => skillMatches(skill, terms));

    return {
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      avatarColor: membership.user.avatarColor,
      roleInDept: membership.roleInDept as DeptRole,
      skills,
      matchedSkills,
      openLeads: openCount.get(membership.userId) ?? 0,
      recommended: matchedSkills.length > 0,
    };
  });

  rows.sort((a, b) => {
    // Best fit first, then the lighter workload, then department leads, then
    // name — so the order is stable rather than dependent on insertion order.
    if (b.matchedSkills.length !== a.matchedSkills.length) {
      return b.matchedSkills.length - a.matchedSkills.length;
    }
    if (a.openLeads !== b.openLeads) return a.openLeads - b.openLeads;
    if (a.roleInDept !== b.roleInDept) return a.roleInDept === "LEAD" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/**
 * Stage keys that end a lead's life in this department.
 *
 * Read from `PipelineStage` rather than string-matching "WON"/"LOST": stages are
 * admin-editable records (Doctrine 3), and a department may rename or add them.
 */
async function terminalStages(departmentId: string): Promise<string[]> {
  const stages = await prisma.pipelineStage.findMany({
    where: {
      departmentId,
      isActive: true,
      OR: [{ isWon: true }, { isLost: true }],
    },
    select: { key: true },
  });
  return stages.map((stage) => stage.key);
}

/**
 * Is this user allowed to be assigned this record?
 *
 * The server calls this before accepting an assignee, so a crafted payload
 * cannot place a record with someone outside the department.
 */
export async function canBeAssigned(
  departmentId: string,
  userId: string,
): Promise<boolean> {
  const membership = await prisma.departmentMembership.findFirst({
    where: { departmentId, userId, user: { isActive: true } },
    select: { id: true },
  });
  return membership !== null;
}
