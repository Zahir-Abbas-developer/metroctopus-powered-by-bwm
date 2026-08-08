import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { ProjectPlanner } from "@/components/projects/ProjectPlanner";
import type { MilestoneStatus, ProjectStatus } from "@/lib/constants";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const project = await prisma.project.findUnique({
    where: { id: params.id },
    select: { title: true, client: { select: { businessName: true } } },
  });

  return {
    title: project ? `${project.client.businessName} · ${project.title}` : "Project",
  };
}

export default async function ProjectPage({ params }: { params: { id: string } }) {
  const user = await requireUser();

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      client: { select: { id: true, businessName: true, industry: true } },
      services: { include: { service: true } },
      modules: {
        orderBy: { order: "asc" },
        include: {
          service: { select: { name: true } },
          milestones: {
            orderBy: [{ order: "asc" }, { dueDate: "asc" }],
            include: {
              assignee: { select: { id: true, name: true, avatarColor: true } },
              scoreEvents: { select: { points: true } },
            },
          },
        },
      },
    },
  });

  if (!project) notFound();

  // Members reach a project through their own task list; the planner itself is
  // the owner's tool. Anyone else lands back on their tasks rather than a 403.
  if (user.role !== "ADMIN") redirect("/my-tasks");

  const members = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: { id: true, name: true, avatarColor: true, jobTitle: true },
  });

  return (
    <ProjectPlanner
      members={members}
      project={{
        id: project.id,
        title: project.title,
        status: project.status as ProjectStatus,
        startDate: project.startDate.toISOString(),
        endDate: project.endDate.toISOString(),
        clientId: project.client.id,
        clientName: project.client.businessName,
        clientIndustry: project.client.industry,
        services: project.services.map((link) => ({
          id: link.service.id,
          name: link.service.name,
          slug: link.service.slug,
        })),
      }}
      modules={project.modules.map((module) => ({
        id: module.id,
        name: module.name,
        order: module.order,
        serviceName: module.service?.name ?? null,
        milestones: module.milestones.map((milestone) => ({
          id: milestone.id,
          title: milestone.title,
          description: milestone.description,
          weight: milestone.weight,
          dueDate: milestone.dueDate.toISOString(),
          status: milestone.status as MilestoneStatus,
          submittedAt: milestone.submittedAt?.toISOString() ?? null,
          completedAt: milestone.completedAt?.toISOString() ?? null,
          order: milestone.order,
          assignee: milestone.assignee,
          scoreImpact: milestone.scoreEvents.reduce((sum, event) => sum + event.points, 0),
        })),
      }))}
    />
  );
}
