import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { fileOutage, outageQuotaFor } from "@/lib/outages";
import { OUTAGE_TYPES } from "@/lib/fairness-windows";
import { hasAdminPower } from "@/lib/constants";

const fileSchema = z.object({
  type: z.enum(OUTAGE_TYPES),
  startsAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  endsAt: z.string().datetime({ offset: true }).or(z.string().datetime()),
  note: z
    .string()
    .trim()
    .min(5, "A short note helps the owner judge it")
    .max(500, "Keep it under 500 characters"),
});

/**
 * GET: the owner sees every report; a member sees only their own, plus how
 * many they have left this month.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const isAdmin = hasAdminPower(user.role);

  const reports = await prisma.outageReport.findMany({
    where: isAdmin ? {} : { userId: user.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: {
      user: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
      reviewedBy: { select: { name: true } },
      checks: { select: { id: true, status: true } },
    },
  });

  return NextResponse.json({
    quota: await outageQuotaFor(user.id),
    reports: reports.map((report) => ({
      id: report.id,
      type: report.type,
      startsAt: report.startsAt.toISOString(),
      endsAt: report.endsAt.toISOString(),
      note: report.note,
      status: report.status,
      filedLate: report.filedLate,
      adminNote: report.adminNote,
      reviewedBy: report.reviewedBy?.name ?? null,
      reviewedAt: report.reviewedAt?.toISOString() ?? null,
      createdAt: report.createdAt.toISOString(),
      checksCovered: report.checks.length,
      member: report.user,
    })),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = fileSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const result = await fileOutage({
    userId: user.id,
    type: parsed.data.type,
    startsAt: new Date(parsed.data.startsAt),
    endsAt: new Date(parsed.data.endsAt),
    note: parsed.data.note,
  });

  if (!result.ok) {
    return apiError(result.reason, 422, result.field ? { [result.field]: result.reason } : undefined);
  }

  return NextResponse.json(result, { status: 201 });
}
