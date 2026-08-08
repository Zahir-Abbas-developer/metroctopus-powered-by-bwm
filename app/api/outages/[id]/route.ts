import { NextResponse } from "next/server";
import { z } from "zod";

import { apiError, requireAdminApi } from "@/lib/api";
import { fieldErrors } from "@/lib/validation";
import { reviewOutage } from "@/lib/outages";

const reviewSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  adminNote: z.string().trim().max(500).nullish(),
});

/** The owner's decision on an outage report. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { user: admin, response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  // Rejecting reinstates a penalty, so it needs a reason on the record — the
  // same standard the excuse and veto paths hold to.
  if (parsed.data.status === "REJECTED" && (parsed.data.adminNote?.trim().length ?? 0) < 5) {
    return apiError("Say why the outage isn't upheld — the member is charged for it", 422, {
      adminNote: "A written reason is required",
    });
  }

  const result = await reviewOutage({
    reportId: params.id,
    adminId: admin!.id,
    approve: parsed.data.status === "APPROVED",
    adminNote: parsed.data.adminNote ?? null,
  });

  if (!result.ok) return apiError(result.reason, 409);

  return NextResponse.json(result);
}
