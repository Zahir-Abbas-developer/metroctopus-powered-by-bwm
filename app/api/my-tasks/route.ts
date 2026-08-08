import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";

/** Every milestone assigned to the signed-in member, across all projects. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  try {
    const milestones = await prisma.milestone.findMany({
      where: { assigneeId: user.id },
      orderBy: [{ dueDate: "asc" }, { order: "asc" }],
      include: {
        module: {
          select: {
            name: true,
            project: {
              select: {
                id: true,
                title: true,
                status: true,
                endDate: true,
                client: { select: { businessName: true } },
              },
            },
          },
        },
      },
    });

    return NextResponse.json({
      milestones: milestones.map((milestone) => ({
        id: milestone.id,
        title: milestone.title,
        description: milestone.description,
        weight: milestone.weight,
        dueDate: milestone.dueDate,
        status: milestone.status,
        submittedAt: milestone.submittedAt,
        completedAt: milestone.completedAt,
        moduleName: milestone.module.name,
        projectId: milestone.module.project.id,
        projectTitle: milestone.module.project.title,
        clientName: milestone.module.project.client.businessName,
      })),
    });
  } catch {
    return apiError("Couldn't load your tasks", 500);
  }
}
