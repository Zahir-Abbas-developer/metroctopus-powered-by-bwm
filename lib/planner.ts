import { prisma } from "@/lib/prisma";
import { addDays, toDateOnly } from "@/lib/date";
import { PROJECT_LENGTH_DAYS } from "@/lib/constants";
import { defaultAssigneeFor, planFor } from "@/lib/templates";

/**
 * Turns a set of selected services into a real plan: modules, dated
 * milestones, and a sensible default owner for each workstream.
 *
 * Shared by the onboarding wizard and the "new engagement" action, so both
 * produce identically structured projects.
 */
export async function createProjectWithPlan(input: {
  clientId: string;
  title: string;
  startDate: Date;
  endDate?: Date;
  serviceIds: string[];
}) {
  const startDate = toDateOnly(input.startDate);
  const endDate = toDateOnly(input.endDate ?? addDays(startDate, PROJECT_LENGTH_DAYS));

  const [services, members] = await Promise.all([
    prisma.serviceCatalog.findMany({ where: { id: { in: input.serviceIds } } }),
    prisma.user.findMany({
      where: { role: "MEMBER", isActive: true },
      select: { id: true, jobTitle: true },
    }),
  ]);

  // Preserve the catalogue's own ordering rather than the order they were ticked.
  const ordered = [...services].sort((a, b) => a.order - b.order);
  const slugs = ordered.map((service) => service.slug);
  const idBySlug = new Map(ordered.map((service) => [service.slug, service.id]));

  const now = new Date();
  const project = await prisma.project.create({
    data: {
      clientId: input.clientId,
      title: input.title,
      startDate,
      endDate,
      status: startDate <= now ? "ACTIVE" : "PLANNING",
      services: { create: ordered.map((service) => ({ serviceId: service.id })) },
    },
  });

  for (const [moduleIndex, entry] of planFor(slugs).entries()) {
    const assigneeId = defaultAssigneeFor(entry.slug, members);

    await prisma.module.create({
      data: {
        projectId: project.id,
        name: entry.module.name,
        serviceId: entry.slug ? (idBySlug.get(entry.slug) ?? null) : null,
        order: moduleIndex,
        milestones: {
          create: entry.module.milestones.map((template, index) => ({
            title: template.title,
            description: template.description,
            weight: template.weight,
            dueDate: toDateOnly(addDays(startDate, template.dayOffset)),
            order: index,
            // Weekly reports stay unassigned on purpose — the owner decides
            // who fronts the client each week.
            assigneeId,
          })),
        },
      },
    });
  }

  return project;
}

/** Milestone counts and completion for a set of projects, in one round trip. */
export async function progressForProjects(projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, { total: number; done: number; percent: number }>();

  const milestones = await prisma.milestone.findMany({
    where: { module: { projectId: { in: projectIds } } },
    select: { status: true, module: { select: { projectId: true } } },
  });

  const result = new Map<string, { total: number; done: number; percent: number }>();
  for (const id of projectIds) result.set(id, { total: 0, done: 0, percent: 0 });

  for (const milestone of milestones) {
    const entry = result.get(milestone.module.projectId);
    if (!entry) continue;
    entry.total += 1;
    if (milestone.status === "COMPLETED") entry.done += 1;
  }

  for (const entry of result.values()) {
    entry.percent = entry.total === 0 ? 0 : Math.round((entry.done / entry.total) * 100);
  }

  return result;
}
