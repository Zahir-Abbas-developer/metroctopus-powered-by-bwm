import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors, updateProjectSchema } from "@/lib/validation";
import { parseDateInput } from "@/lib/date";

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const existing = await prisma.project.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That engagement no longer exists", 404);

  const { startDate, endDate, ...rest } = parsed.data;
  const start = startDate ? parseDateInput(startDate) : undefined;
  const end = endDate ? parseDateInput(endDate) : undefined;

  if (startDate && !start) return apiError("Enter a valid start date", 422, { startDate: "Use a valid date" });
  if (endDate && !end) return apiError("Enter a valid end date", 422, { endDate: "Use a valid date" });

  const nextStart = start ?? existing.startDate;
  const nextEnd = end ?? existing.endDate;
  if (nextEnd <= nextStart) {
    return apiError("The cycle must end after it starts", 422, {
      endDate: "Must be after the start date",
    });
  }

  try {
    const project = await prisma.project.update({
      where: { id: params.id },
      data: {
        ...rest,
        ...(start ? { startDate: start } : {}),
        ...(end ? { endDate: end } : {}),
        // Re-opening a closed-out cycle lets the evaluation job settle it again.
        ...(rest.status && rest.status !== "COMPLETED" && rest.status !== "OVERDUE_CLOSEOUT"
          ? { closedOutAt: null }
          : {}),
      },
    });
    return NextResponse.json({ project });
  } catch {
    return apiError("Couldn't save those changes", 500);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const { response } = await requireAdminApi();
  if (response) return response;

  const existing = await prisma.project.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That engagement no longer exists", 404);

  try {
    await prisma.project.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch {
    return apiError("Couldn't remove this engagement", 500);
  }
}
