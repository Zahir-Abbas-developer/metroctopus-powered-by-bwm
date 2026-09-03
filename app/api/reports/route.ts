import { NextResponse } from "next/server";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { fieldErrors } from "@/lib/validation";
import { REPORT_TYPES, generateReports, parsePayload } from "@/lib/reports";
import { parseDateInput } from "@/lib/date";
import { hasAdminPower } from "@/lib/constants";

/** Members only ever see their own; admins see everything, filterable. */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const userId = searchParams.get("userId");
  const period = searchParams.get("period");

  const isAdmin = hasAdminPower(user.role);

  try {
    const reports = await prisma.report.findMany({
      where: {
        ...(isAdmin ? {} : { userId: user.id }),
        ...(type && type !== "ALL" ? { type } : {}),
        ...(isAdmin && userId && userId !== "ALL" ? { userId } : {}),
        ...(period ? { periodStart: parseDateInput(period) ?? undefined } : {}),
      },
      orderBy: [{ periodStart: "desc" }, { type: "asc" }],
      take: 200,
      include: {
        user: { select: { id: true, name: true, avatarColor: true, jobTitle: true } },
        client: { select: { id: true, businessName: true } },
      },
    });

    return NextResponse.json({
      reports: reports.map((report) => {
        const payload = parsePayload(report.payload);
        return {
          id: report.id,
          type: report.type,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
          periodLabel: payload.period.label,
          generatedAt: report.generatedAt,
          subject:
            payload.kind === "MEMBER"
              ? { kind: "MEMBER", name: payload.member.name, color: payload.member.avatarColor }
              : { kind: "CLIENT", name: payload.client.name, color: null },
          headline:
            payload.kind === "MEMBER" ? payload.narrative.third : payload.narrative,
          score: payload.kind === "MEMBER" ? payload.score.value : null,
          bandColor: payload.kind === "MEMBER" ? payload.score.bandColor : null,
        };
      }),
    });
  } catch {
    return apiError("Couldn't load reports", 500);
  }
}

const generateSchema = z.object({
  types: z.array(z.enum(REPORT_TYPES)).min(1, "Pick at least one report type"),
  /** Any date inside the period to report on; defaults to today. */
  reference: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  /** Overwrite an existing report for the period instead of skipping it. */
  regenerate: z.boolean().optional(),
});

export async function POST(request: Request) {
  const { response } = await requireAdminApi();
  if (response) return response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid request body", 400);
  }

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const reference = parsed.data.reference
    ? parseDateInput(parsed.data.reference)
    : new Date();
  if (!reference) {
    return apiError("Enter a valid date", 422, { reference: "Use a valid date" });
  }

  try {
    const result = await generateReports({
      types: parsed.data.types,
      reference,
      regenerate: parsed.data.regenerate,
    });
    return NextResponse.json(result, { status: 201 });
  } catch {
    return apiError("Report generation failed", 500);
  }
}
