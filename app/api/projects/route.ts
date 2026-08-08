import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { createProjectSchema, fieldErrors } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";
import { createProjectWithPlan } from "@/lib/planner";

/** Start a new engagement cycle for an existing client. */
export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const start = parseDateInput(parsed.data.startDate);
  if (!start) return apiError("Enter a valid start date", 422, { startDate: "Use a valid date" });

  const end = parsed.data.endDate ? parseDateInput(parsed.data.endDate) : null;
  if (parsed.data.endDate && !end) {
    return apiError("Enter a valid end date", 422, { endDate: "Use a valid date" });
  }
  if (end && end <= start) {
    return apiError("The cycle must end after it starts", 422, {
      endDate: "Must be after the start date",
    });
  }

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId } });
  if (!client) return apiError("That client no longer exists", 404);

  // One live cycle at a time per client — overlapping retainers would make the
  // "current project" on every card ambiguous.
  const overlapping = await prisma.project.findFirst({
    where: {
      clientId: client.id,
      status: { in: ["PLANNING", "ACTIVE"] },
      startDate: { lte: end ?? start },
      endDate: { gte: start },
    },
  });
  if (overlapping) {
    return apiError(
      `${client.businessName} already has a live engagement covering those dates`,
      409,
      { startDate: "Overlaps an existing cycle" },
    );
  }

  try {
    const project = await createProjectWithPlan({
      clientId: client.id,
      title: parsed.data.title,
      startDate: start,
      endDate: end ?? undefined,
      serviceIds: parsed.data.serviceIds,
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch {
    return apiError("Couldn't create this engagement", 500);
  }
}
