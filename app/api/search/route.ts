import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";

/**
 * Command palette search across clients, projects, milestones and members.
 *
 * Scoped by role in the queries themselves: a member searches their own
 * milestones and the roster, and nothing else. `contains` without Prisma's
 * `mode: "insensitive"` keeps this portable — that option is Postgres-only,
 * and SQLite's LIKE is already case-insensitive for ASCII.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2) return NextResponse.json({ results: [] });

  const isAdmin = user.role === "ADMIN";

  try {
    const [clients, projects, milestones, members] = await Promise.all([
      isAdmin
        ? prisma.client.findMany({
            where: { businessName: { contains: query } },
            take: 5,
            select: { id: true, businessName: true, industry: true, status: true },
          })
        : [],
      isAdmin
        ? prisma.project.findMany({
            where: { title: { contains: query } },
            take: 5,
            select: {
              id: true,
              title: true,
              client: { select: { businessName: true } },
            },
          })
        : [],
      prisma.milestone.findMany({
        where: {
          title: { contains: query },
          ...(isAdmin ? {} : { assigneeId: user.id }),
        },
        take: 6,
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
      }),
      prisma.user.findMany({
        where: { name: { contains: query }, isActive: true },
        take: 5,
        select: { id: true, name: true, jobTitle: true, avatarColor: true, role: true },
      }),
    ]);

    return NextResponse.json({
      results: [
        ...clients.map((client) => ({
          kind: "client" as const,
          id: client.id,
          title: client.businessName,
          subtitle: client.industry ?? "Client",
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
