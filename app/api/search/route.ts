import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { viewerFor } from "@/lib/viewer";
import { departmentScope } from "@/lib/visibility";
import { containsInsensitive } from "@/lib/db-features";
import { getModuleFlags } from "@/lib/modules";
import { hasAdminPower } from "@/lib/constants";

/**
 * Command palette search.
 *
 * Two things changed here for BWM. It now searches **leads**, which it did not
 * before — the pipeline was invisible to the one control meant to find
 * anything. And every record query is department-scoped through the same
 * `departmentScope` the lists use, so a hit can never surface a record the
 * viewer could not open.
 *
 * Scoping search is not the same problem as scoping a list. A list shows what
 * you asked for; search answers whether something *exists* — so an unscoped
 * result leaks the existence, the name, and often the phone number of a record
 * in a department that is not yours, even if clicking it 404s.
 *
 * Matching goes through containsInsensitive, which adds Postgres's
 * `mode: "insensitive"`. Without it search works locally on SQLite and quietly
 * stops matching case in production.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  const isAdmin = hasAdminPower(user.role);
  const viewer = await viewerFor(user);
  const scope = departmentScope(viewer);

  // A member of no department matches nothing rather than everything — the
  // direction a missing filter has to fail in.
  if (!isAdmin && viewer.departmentIds.length === 0) {
    return NextResponse.json({ results: [] });
  }

  /**
   * The columns worth searching on a person or a company.
   *
   * Phone and email are partial matches on purpose: half a number read off a
   * missed call is the most common thing anybody types into this box.
   */
  const contactMatch = [
    { businessName: containsInsensitive(query) },
    { contactName: containsInsensitive(query) },
    { email: containsInsensitive(query) },
    { phone: containsInsensitive(query) },
  ];

  try {
    const flags = await getModuleFlags();

    const [leads, clients, members, projects, milestones] = await Promise.all([
      prisma.lead.findMany({
        where: { ...scope, OR: contactMatch },
        take: 6,
        orderBy: { stageChangedAt: "desc" },
        select: {
          id: true,
          businessName: true,
          contactName: true,
          stage: true,
          department: { select: { shortLabel: true } },
        },
      }),
      prisma.client.findMany({
        where: { ...scope, OR: contactMatch },
        take: 6,
        select: {
          id: true,
          businessName: true,
          industry: true,
          status: true,
          department: { select: { shortLabel: true } },
        },
      }),
      prisma.user.findMany({
        where: { name: containsInsensitive(query), isActive: true },
        take: 5,
        select: { id: true, name: true, jobTitle: true, avatarColor: true, role: true },
      }),
      // Retainer projects are a parked module. Searching them would surface a
      // link to a page the module gate answers with "switched off", which is a
      // worse result than no result.
      flags.retainerProjects && isAdmin
        ? prisma.project.findMany({
            where: { title: containsInsensitive(query) },
            take: 4,
            select: {
              id: true,
              title: true,
              client: { select: { businessName: true } },
            },
          })
        : [],
      flags.retainerProjects
        ? prisma.milestone.findMany({
            where: {
              title: containsInsensitive(query),
              ...(isAdmin ? {} : { assigneeId: user.id }),
            },
            take: 4,
            orderBy: { dueDate: "asc" },
            select: {
              id: true,
              title: true,
              status: true,
              module: {
                select: {
                  project: {
                    select: { id: true, client: { select: { businessName: true } } },
                  },
                },
              },
            },
          })
        : [],
    ]);

    return NextResponse.json({
      results: [
        ...leads.map((lead) => ({
          kind: "lead" as const,
          id: lead.id,
          title: lead.businessName,
          subtitle: `${lead.department.shortLabel} · ${lead.contactName}`,
          href: `/pipeline?lead=${lead.id}`,
        })),
        ...clients.map((client) => ({
          kind: "client" as const,
          id: client.id,
          title: client.businessName,
          subtitle: `${client.department.shortLabel} · ${client.industry ?? "Client"}`,
          href: `/clients/${client.id}`,
        })),
        ...projects.map((project) => ({
          kind: "project" as const,
          id: project.id,
          title: project.title,
          subtitle: project.client.businessName,
          href: `/projects/${project.id}`,
        })),
        ...milestones.map((milestone) => ({
          kind: "milestone" as const,
          id: milestone.id,
          title: milestone.title,
          subtitle: milestone.module.project.client.businessName,
          // Opens the drawer on the board rather than a dead end.
          href: `/board?milestone=${milestone.id}`,
        })),
        ...members.map((member) => ({
          kind: "member" as const,
          id: member.id,
          title: member.name,
          subtitle: member.jobTitle,
          href: isAdmin ? `/team/${member.id}` : "/my-performance",
        })),
      ],
    });
  } catch {
    return apiError("Search failed", 500);
  }
}
