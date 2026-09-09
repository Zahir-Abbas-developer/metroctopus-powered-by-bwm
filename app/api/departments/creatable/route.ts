import { NextResponse } from "next/server";

import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { creatableDepartments } from "@/lib/departments";
import { hasAdminPower } from "@/lib/constants";

/**
 * Step 1 of the creation wizard: which business lines this viewer may file
 * under.
 *
 * Deliberately not the admin `GET /api/departments`, which returns every
 * department with its full roster and record counts. This answers a narrower
 * question for a wider audience, so it returns only what the picker card draws.
 *
 * The scoping is the point: Tayyaba belongs to Pilot Cars and Life & Health, so
 * Affiliates and Culture Plus are absent from her response — not hidden in the
 * component, absent from the payload.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const departments = await creatableDepartments(user.id, hasAdminPower(user.role));
  return NextResponse.json({ departments });
}
