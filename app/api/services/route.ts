import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";

const serviceSchema = z.object({
  name: z.string().trim().min(2, "Name the service").max(80),
  description: z.string().trim().max(300).optional(),
});

export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  try {
    const services = await prisma.serviceCatalog.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
    });
    return NextResponse.json({ services });
  } catch {
    return apiError("Couldn't load the service catalogue", 500);
  }
}

export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = serviceSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  // A custom service has no built-in template, so its projects start with just
  // the reporting module. The slug is derived once and then frozen.
  const slug = parsed.data.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);

  const last = await prisma.serviceCatalog.findFirst({ orderBy: { order: "desc" } });

  try {
    const service = await prisma.serviceCatalog.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        slug,
        order: (last?.order ?? 0) + 1,
      },
    });
    return NextResponse.json({ service }, { status: 201 });
  } catch {
    return apiError("A service with that name already exists", 409, {
      name: "Already in the catalogue",
    });
  }
}
