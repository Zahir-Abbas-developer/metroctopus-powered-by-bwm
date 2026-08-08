import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, onboardClientSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { createProjectWithPlan, progressForProjects } from "@/lib/planner";

export async function GET(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const query = searchParams.get("q")?.trim();

  try {
    const clients = await prisma.client.findMany({
      where: {
        ...(status && status !== "ALL" ? { status } : {}),
        // SQLite's LIKE is already case-insensitive for ASCII, and Prisma's
        // `mode: "insensitive"` is Postgres-only — leaving it off keeps this
        // query portable across both.
        ...(query ? { businessName: { contains: query } } : {}),
      },
      orderBy: [{ status: "asc" }, { businessName: "asc" }],
      include: {
        projects: {
          orderBy: { startDate: "desc" },
          take: 1,
          include: { services: { include: { service: true } } },
        },
      },
    });

    const progress = await progressForProjects(
      clients.map((client) => client.projects[0]?.id).filter((id): id is string => Boolean(id)),
    );

    return NextResponse.json({
      clients: clients.map((client) => {
        const current = client.projects[0] ?? null;
        return {
          id: client.id,
          businessName: client.businessName,
          contactName: client.contactName,
          email: client.email,
          country: client.country,
          industry: client.industry,
          monthlyBudget: client.monthlyBudget,
          status: client.status,
          onboardedAt: client.onboardedAt,
          services: current
            ? current.services.map((link) => ({
                id: link.service.id,
                name: link.service.name,
                slug: link.service.slug,
              }))
            : [],
          currentProject: current
            ? {
                id: current.id,
                title: current.title,
                status: current.status,
                startDate: current.startDate,
                endDate: current.endDate,
                progress: progress.get(current.id) ?? { total: 0, done: 0, percent: 0 },
              }
            : null,
        };
      }),
    });
  } catch {
    return apiError("Couldn't load your clients", 500);
  }
}

/** The 3-step onboarding wizard: client, services, and the first engagement. */
export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = onboardClientSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const { serviceIds, projectTitle, startDate, ...details } = parsed.data;

  const start = parseDateInput(startDate);
  if (!start) return apiError("Enter a valid start date", 422, { startDate: "Use a valid date" });

  const services = await prisma.serviceCatalog.findMany({
    where: { id: { in: serviceIds }, isActive: true },
    select: { id: true },
  });
  if (services.length !== serviceIds.length) {
    return apiError("One of those services no longer exists", 422, {
      serviceIds: "Refresh and pick the services again",
    });
  }

  try {
    const client = await prisma.client.create({
      data: {
        ...details,
        onboardedAt: new Date(),
      },
    });

    const project = await createProjectWithPlan({
      clientId: client.id,
      title: projectTitle,
      startDate: start,
      serviceIds,
    });

    return NextResponse.json({ client, project }, { status: 201 });
  } catch {
    return apiError("Couldn't onboard this client", 500);
  }
}
