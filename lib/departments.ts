import { prisma } from "@/lib/prisma";
import { parseSkills } from "@/lib/skills";
import type { DeptRole } from "@/lib/constants";

/**
 * Department reads, shaped once.
 *
 * Every screen that shows a department shows the same three things — what it
 * is, who is in it, and what they do there — so the shape is defined here
 * rather than re-assembled per route. Skills are parsed into arrays at this
 * boundary so nothing downstream ever sees the stored comma-separated string.
 */

export type DepartmentMemberView = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  avatarColor: string;
  role: string;
  roleInDept: DeptRole;
  skills: string[];
};

export type DepartmentView = {
  id: string;
  slug: string;
  name: string;
  shortLabel: string;
  colorToken: string | null;
  description: string | null;
  order: number;
  isActive: boolean;
  members: DepartmentMemberView[];
  /** Live records pointing at this department — what blocks deactivation. */
  counts: { clients: number; leads: number };
};

export async function listDepartments(): Promise<DepartmentView[]> {
  const rows = await prisma.department.findMany({
    orderBy: [{ order: "asc" }, { name: "asc" }],
    include: {
      memberships: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatarColor: true, role: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
      _count: { select: { clients: true, leads: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    shortLabel: row.shortLabel,
    colorToken: row.colorToken,
    description: row.description,
    order: row.order,
    isActive: row.isActive,
    members: row.memberships.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      avatarColor: m.user.avatarColor,
      role: m.user.role,
      roleInDept: m.roleInDept as DeptRole,
      skills: parseSkills(m.skills),
    })),
    counts: { clients: row._count.clients, leads: row._count.leads },
  }));
}

/**
 * Departments a person can see.
 *
 * An admin sees every active department; everyone else sees the ones they
 * belong to. Callers that scope data must use this rather than listing all
 * departments and filtering in the UI — a filter in a component still shipped
 * the rows to the browser.
 */
export async function departmentIdsForUser(
  userId: string,
  isAdmin: boolean,
): Promise<string[]> {
  if (isAdmin) {
    const all = await prisma.department.findMany({
      where: { isActive: true },
      select: { id: true },
    });
    return all.map((d) => d.id);
  }

  const mine = await prisma.departmentMembership.findMany({
    where: { userId, department: { isActive: true } },
    select: { departmentId: true },
  });
  return mine.map((m) => m.departmentId);
}

/** Slug from a display name, unique-ified against what already exists. */
export async function uniqueSlug(name: string, excludeId?: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "department";

  for (let n = 0; ; n += 1) {
    const candidate = n === 0 ? base : `${base}-${n + 1}`;
    const clash = await prisma.department.findFirst({
      where: { slug: candidate, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    if (!clash) return candidate;
  }
}
