import { prisma } from "@/lib/prisma";
import { parseSkills } from "@/lib/skills";
import { sharedTerms, tokenise } from "@/lib/matching";
import { TERMINAL_STAGE_KINDS, type DeptRole } from "@/lib/constants";

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
 *
 * The ranking reads two sources, weighted differently on purpose:
 *
 * - **Skills** on the department membership, which an admin set deliberately
 *   for this business line. Worth more, because they were an explicit answer to
 *   "what does this person do here".
 * - **The job title** on the user record, which is free text describing the
 *   specialism — "Shopify Developer", "Media Buyer". Worth less, because it is
 *   a label rather than a per-department statement, but worth *something*: a
 *   Shopify job landing on the Shopify developer should not depend on someone
 *   having remembered to retype "shopify" into a skills box.
 *
 * ## What the department's own name is, and is not
 *
 * The department's name and slug are *not* part of the match. Every member of
 * "Pilot Cars Sales & Dispatch" has "sales" or "dispatch" in their skills, so
 * scoring against the department name scores everybody — and does it loudest
 * for whoever happened to list the most of the department's own words, which is
 * a fact about data entry rather than about the work. Worse, it drowns the one
 * term that actually described the job: a Shopify brief filed in a sales
 * department would rank on "sales" and "dispatch" and never notice "shopify".
 *
 * So the name is kept as `affinityScore` and used only to break a tie once the
 * real match and the workload have both had their say. That preserves the
 * behaviour it was added for — a department asked with no context at all still
 * puts the people whose skills name it first — without letting it pretend to be
 * evidence about a specific piece of work.
 */

export type AssignableMember = {
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  /** Free-text specialism from the user record, e.g. "Shopify Developer". */
  jobTitle: string;
  roleInDept: DeptRole;
  skills: string[];
  /** Skills that matched the work — why this row is recommended. */
  matchedSkills: string[];
  /** Terms the job title shares with the work, when the skills missed. */
  matchedTitleTerms: string[];
  /**
   * The ranking number. Zero means nothing about *this work* named this person,
   * however high they appear — position alone is not a recommendation.
   */
  matchScore: number;
  /** Live count of leads they own that are neither won nor lost. */
  openLeads: number;
  /** Live count of open tasks they carry. The other half of "how busy". */
  openTasks: number;
  recommended: boolean;
};

/** A skill named the work: the strongest signal, and a deliberate one. */
const SKILL_WEIGHT = 3;
/** The job title named the work: real, but a label rather than a decision. */
const TITLE_WEIGHT = 2;

/**
 * Members of one department, ranked for assignment.
 *
 * `context` is free text describing the work — the services asked for, the
 * answers to the department's own questions, the note somebody typed. Empty is
 * a legitimate input: it means nothing is known about this job yet, and the
 * ordering falls back to workload and department affinity.
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
      user: {
        select: { id: true, name: true, email: true, avatarColor: true, jobTitle: true },
      },
    },
  });
  if (memberships.length === 0) return [];

  const userIds = memberships.map((m) => m.userId);

  // Two grouped queries rather than two per member: the counts are shown next
  // to every name, so per-row queries would scale with the size of the
  // department.
  const [openByOwner, taskByAssignee] = await Promise.all([
    prisma.lead.groupBy({
      by: ["ownerId"],
      where: {
        departmentId,
        ownerId: { in: userIds },
        convertedAt: null,
        stage: { notIn: await terminalStages(departmentId) },
      },
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ["assigneeId"],
      where: { departmentId, assigneeId: { in: userIds }, completedAt: null },
      _count: { _all: true },
    }),
  ]);

  const openCount = new Map(
    openByOwner.map((row) => [row.ownerId ?? "", row._count._all]),
  );
  const taskCount = new Map(
    taskByAssignee.map((row) => [row.assigneeId ?? "", row._count._all]),
  );

  /* The two vocabularies, kept apart. `workTerms` describes this job and is the
     only thing allowed to produce a match; `departmentTerms` describes the
     business line and can do nothing but break a tie. */
  const workTerms = tokenise(...context);
  const departmentTerms = tokenise(
    department.slug,
    department.shortLabel,
    department.name,
  );

  const rows: Candidate[] = memberships.map((membership) => {
    const skills = parseSkills(membership.skills);

    const matchedSkills = skills.filter(
      (skill) => sharedTerms(skill, workTerms).length > 0,
    );
    const matchedTitleTerms = sharedTerms(membership.user.jobTitle, workTerms);

    const affinity =
      skills.filter((skill) => sharedTerms(skill, departmentTerms).length > 0).length;

    return {
      userId: membership.userId,
      name: membership.user.name,
      email: membership.user.email,
      avatarColor: membership.user.avatarColor,
      jobTitle: membership.user.jobTitle,
      roleInDept: membership.roleInDept as DeptRole,
      skills,
      matchedSkills,
      matchedTitleTerms,
      matchScore:
        matchedSkills.length * SKILL_WEIGHT + matchedTitleTerms.length * TITLE_WEIGHT,
      openLeads: openCount.get(membership.userId) ?? 0,
      openTasks: taskCount.get(membership.userId) ?? 0,
      recommended: matchedSkills.length > 0 || matchedTitleTerms.length > 0,
      affinityScore: affinity,
    };
  });

  rows.sort(compareCandidates);

  return rows.map(({ affinityScore: _affinity, ...member }) => member);
}

/** A member plus the tie-break that never leaves this module. */
type Candidate = AssignableMember & { affinityScore: number };

/**
 * Real match first, then the lighter workload, then affinity to the department,
 * then department leads, then name.
 *
 * Workload beats affinity deliberately. Once nothing in the brief named anyone,
 * the useful question stops being "who sounds like this department" — everybody
 * in it does — and becomes "who has room". Name is last so the order is stable
 * rather than dependent on insertion order: the same inputs must produce the
 * same recommendation every time, or nobody can reason about why a record went
 * where it went.
 */
function compareCandidates(a: Candidate, b: Candidate): number {
  if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;

  const loadA = a.openLeads + a.openTasks;
  const loadB = b.openLeads + b.openTasks;
  if (loadA !== loadB) return loadA - loadB;

  if (b.affinityScore !== a.affinityScore) return b.affinityScore - a.affinityScore;

  if (a.roleInDept !== b.roleInDept) return a.roleInDept === "LEAD" ? -1 : 1;
  return a.name.localeCompare(b.name);
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
      kind: { in: [...TERMINAL_STAGE_KINDS] },
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
