import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { progressForProjects } from "@/lib/planner";
import { ClientDetail } from "@/components/clients/ClientDetail";
import type { ClientStatus, ProjectStatus } from "@/lib/constants";

export async function generateMetadata({
  params,
}: {
  params: { id: string };
}): Promise<Metadata> {
  const client = await prisma.client.findUnique({
    where: { id: params.id },
    select: { businessName: true },
  });

  return { title: client?.businessName ?? "Client" };
}

export default async function ClientDetailPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAdmin();

  const [client, services] = await Promise.all([
    prisma.client.findUnique({
      where: { id: params.id },
      include: {
        projects: {
          orderBy: { startDate: "desc" },
          include: { services: { include: { service: true } } },
        },
      },
    }),
    prisma.serviceCatalog.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { id: true, name: true, slug: true, description: true },
    }),
  ]);

  if (!client) notFound();

  const progress = await progressForProjects(client.projects.map((project) => project.id));

  return (
    <ClientDetail
      services={services}
      client={{
        id: client.id,
        businessName: client.businessName,
        contactName: client.contactName,
        email: client.email,
        phone: client.phone,
        country: client.country,
        industry: client.industry,
        monthlyBudget: client.monthlyBudget,
        status: client.status as ClientStatus,
        notes: client.notes,
        onboardedAt: client.onboardedAt.toISOString(),
      }}
      projects={client.projects.map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status as ProjectStatus,
        startDate: project.startDate.toISOString(),
        endDate: project.endDate.toISOString(),
        services: project.services.map((link) => ({
          id: link.service.id,
          name: link.service.name,
          slug: link.service.slug,
        })),
        progress: progress.get(project.id) ?? { total: 0, done: 0, percent: 0 },
      }))}
    />
  );
}
