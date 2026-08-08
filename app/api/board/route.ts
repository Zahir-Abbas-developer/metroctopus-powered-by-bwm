import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";

/**
 * Every milestone the viewer is allowed to see, shaped for the board.
 *
 * Members are scoped to their own work in the query itself, not by filtering
 * on the client — the board must not ship other people's milestones to a
 * browser that then hides them.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");
  const assigneeId = searchParams.get("assigneeId");
  const serviceId = searchParams.get("serviceId");

  const isAdmin = user.role === "ADMIN";

  try {
    const milestones = await prisma.milestone.findMany({
      where: {
        ...(isAdmin ? {} : { assigneeId: user.id }),
        ...(isAdmin && assigneeId && assigneeId !== "ALL" ? { assigneeId } : {}),
        ...(projectId && projectId !== "ALL"
          ? { module: { projectId } }
          : {}),
        ...(serviceId && serviceId !== "ALL"
          ? { module: { serviceId } }
          : {}),
      },
      orderBy: [{ dueDate: "asc" }, { order: "asc" }],
      include: {
        assignee: { select: { id: true, name: true, avatarColor: true } },
        module: {
          select: {
            id: true,
            name: true,
            serviceId: true,
            project: {
              select: {
                id: true,
                title: true,
                client: { select: { id: true, businessName: true } },
              },
            },
          },
        },
      },
    });

    // Filter options come from what the viewer can actually see, so a member
    // never gets a dropdown full of projects they have no work on.
    const projects = new Map<string, string>();
    const services = new Map<string, string>();
    for (const milestone of milestones) {
      projects.set(
        milestone.module.project.id,
        `${milestone.module.project.client.businessName} · ${milestone.module.project.title}`,
      );
      if (milestone.module.serviceId) {
        services.set(milestone.module.serviceId, milestone.module.name);
      }
    }

    const members = isAdmin
      ? await prisma.user.findMany({
          where: { isActive: true },
          orderBy: { name: "asc" },
          select: { id: true, name: true, avatarColor: true },
        })
      : [];

    return NextResponse.json({
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        status: milestone.status,
        weight: milestone.weight,
        dueDate: milestone.dueDate,
        assignee: milestone.assignee,
        moduleName: milestone.module.name,
        projectId: milestone.module.project.id,
        projectTitle: milestone.module.project.title,
        clientName: milestone.module.project.client.businessName,
        serviceId: milestone.module.serviceId,
      })),
      filters: {
        projects: [...projects].map(([id, label]) => ({ id, label })),
        services: [...services].map(([id, label]) => ({ id, label })),
        members,
      },
    });
  } catch {
    return apiError("Couldn't load the board", 500);
  }
}
