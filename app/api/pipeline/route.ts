import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { apiError } from "@/lib/api";
import { getCurrentUser } from "@/lib/session";
import { viewerFor } from "@/lib/viewer";
import { canSeePipelineTotals } from "@/lib/visibility";
import { serializeLead } from "@/lib/serializers";
import { creatableDepartments } from "@/lib/departments";
import { commissionsFor, stagesFor } from "@/lib/stages";
import { hasAdminPower } from "@/lib/constants";

/**
 * One department's board.
 *
 * Separate from `GET /api/leads`, which answers "every lead" for the older
 * global pipeline. A board is always a board *of something*: its columns are
 * the chosen department's `PipelineStage` rows, in that department's order,
 * with that department's colours. Nothing here knows how many stages exist or
 * what they are called (Doctrine 3).
 *
 * The department defaults to the viewer's first, so a member with one business
 * line never has to choose.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError("You must be signed in", 401);

  const isAdmin = hasAdminPower(user.role);
  const departments = await creatableDepartments(user.id, isAdmin);

  if (departments.length === 0) {
    return NextResponse.json({
      departments: [],
      department: null,
      stages: [],
      leads: [],
      totals: [],
      commissions: [],
      viewer: { id: user.id, isAdmin },
    });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get("departmentId");
  const department =
    departments.find((row) => row.id === requested) ?? departments[0];

  // A requested department the viewer is not in is refused rather than quietly
  // swapped for one they are in — silently showing different data than was
  // asked for is how people come to trust the wrong number.
  if (requested && requested !== department.id) {
    return apiError("That department isn't one of yours", 403);
  }

  const viewer = await viewerFor(user);
  const ownerId = searchParams.get("ownerId");

  const [stages, leads, commissions, services] = await Promise.all([
    stagesFor(department.id),
    prisma.lead.findMany({
      where: {
        departmentId: department.id,
        ...(ownerId && ownerId !== "ALL" ? { ownerId } : {}),
      },
      orderBy: [{ stageChangedAt: "desc" }],
      include: {
        owner: { select: { id: true, name: true, avatarColor: true } },
        _count: { select: { activities: true } },
      },
    }),
    commissionsFor(department.id),
    // Still supplied to the creation form: the service catalogue is an
    // inherited concept awaiting a decision, and dropping it here would remove
    // a working field by omission rather than by choice.
    prisma.serviceCatalog.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      select: { slug: true, name: true },
    }),
  ]);

  const serialized = leads.map((lead) =>
    serializeLead(
      {
        id: lead.id,
        businessName: lead.businessName,
        contactName: lead.contactName,
        email: lead.email,
        phone: lead.phone,
        source: lead.source,
        country: lead.country,
        interestedServices: lead.interestedServices
          .split(",")
          .map((slug) => slug.trim())
          .filter(Boolean),
        estimatedMonthlyValue: lead.estimatedMonthlyValue,
        dealValue: lead.dealValue,
        ownerId: lead.ownerId,
        stage: lead.stage,
        stageChangedAt: lead.stageChangedAt,
        lostReason: lead.lostReason,
        lostNote: lead.lostNote,
        owner: lead.owner,
        activityCount: lead._count.activities,
        convertedClientId: lead.convertedClientId,
        createdAt: lead.createdAt,
      },
      viewer,
    ),
  );

  // Column headers carry a count for everyone and a total only for those
  // allowed the money — a stage with four small deals and a stage with one
  // large one are not the same pipeline, and a count alone says they are.
  const showTotals = canSeePipelineTotals(viewer);
  const totals = stages.map((stage) => {
    const inStage = leads.filter((lead) => lead.stage === stage.key);
    return {
      stage: stage.key,
      count: inStage.length,
      ...(showTotals
        ? { value: inStage.reduce((sum, lead) => sum + lead.dealValue, 0) }
        : {}),
    };
  });

  return NextResponse.json({
    departments: departments.map((row) => ({
      id: row.id,
      shortLabel: row.shortLabel,
      name: row.name,
      colorToken: row.colorToken,
    })),
    department: {
      id: department.id,
      name: department.name,
      shortLabel: department.shortLabel,
      colorToken: department.colorToken,
    },
    stages,
    leads: serialized,
    totals,
    // Commission is money: the table is only assembled for viewers allowed to
    // see deal values at all.
    commissions: showTotals ? commissions : [],
    services,
    viewer: { id: user.id, isAdmin, canSeeDealValues: showTotals },
  });
}
