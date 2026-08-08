import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";

const updateServiceSchema = z
  .object({
    name: z.string().trim().min(2, "Name the service").max(80).optional(),
    description: z.string().trim().max(300).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

/**
 * Rename a service, reword it, or retire it.
 *
 * The `slug` is deliberately never editable: it keys the built-in planning
 * template, so renaming "Google Ads Management" must not orphan the plan it
 * generates.
 */
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

  const parsed = updateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const existing = await prisma.serviceCatalog.findUnique({ where: { id: params.id } });
  if (!existing) return apiError("That service no longer exists", 404);

  // Retiring the last service would leave the onboarding wizard with nothing
  // to offer, and no way back through the UI.
  if (parsed.data.isActive === false) {
    const others = await prisma.serviceCatalog.count({
      where: { isActive: true, id: { not: params.id } },
    });
    if (others === 0) {
      return apiError("Keep at least one service in the catalogue", 400);
    }
  }

  try {
    const service = await prisma.serviceCatalog.update({
      where: { id: params.id },
      data: parsed.data,
    });
    return NextResponse.json({ service });
  } catch {
    return apiError("A service with that name already exists", 409, {
      name: "Already in the catalogue",
    });
  }
}
