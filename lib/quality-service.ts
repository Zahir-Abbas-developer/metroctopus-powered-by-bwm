import { prisma } from "@/lib/prisma";
import type { Cycle } from "@/lib/score-service";

/**
 * Average quality for one member in one cycle.
 *
 * Scoped by `qualityRatedAt` rather than by the milestone's due date: the
 * rating is a fact about when the owner judged the work, and a milestone due
 * in March that was finally approved in May belongs to May's quality picture.
 */
export async function qualityForCycle(
  userId: string,
  cycle: Cycle,
): Promise<{ average: number | null; rated: number }> {
  const from = new Date(Date.UTC(cycle.year, cycle.month - 1, 1));
  const to = new Date(Date.UTC(cycle.year, cycle.month, 1));

  const rated = await prisma.milestone.findMany({
    where: {
      assigneeId: userId,
      qualityRating: { not: null },
      qualityRatedAt: { gte: from, lt: to },
    },
    select: { qualityRating: true },
  });

  if (rated.length === 0) return { average: null, rated: 0 };

  const total = rated.reduce((sum, row) => sum + (row.qualityRating ?? 0), 0);

  return {
    // One decimal place: "4.3" is a meaningfully different report from "4",
    // and two places would imply a precision five ratings cannot carry.
    average: Math.round((total / rated.length) * 10) / 10,
    rated: rated.length,
  };
}
