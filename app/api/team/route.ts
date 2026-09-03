import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { apiError, requireAdminApi } from "@/lib/api";
import { createUserSchema, fieldErrors } from "@/lib/validation";
import { avatarColorFor } from "@/lib/constants";
import { parseSkills } from "@/lib/skills";
import { currentCycle, performanceContext, scoresForCycle } from "@/lib/score-service";
import { MONTHLY_BASELINE } from "@/lib/scoring";
import { sendWelcome } from "@/lib/email/dispatch";

/** Columns safe to return — never the password hash. */
const SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  jobTitle: true,
  avatarColor: true,
  isActive: true,
  createdAt: true,
  departments: {
    select: {
      departmentId: true,
      roleInDept: true,
      skills: true,
      department: { select: { shortLabel: true, colorToken: true, order: true, isActive: true } },
    },
  },
} as const;

export async function GET() {
  const { response } = await requireAdminApi();
  if (response) return response;

  try {
    const members = await prisma.user.findMany({
      select: SELECT,
      // Owner first, then active members, then the deactivated ones.
      orderBy: [{ role: "asc" }, { isActive: "desc" }, { name: "asc" }],
    });

    // Scores ride along with the list so the team table can sort by them
    // without a second round trip per row.
    const cycle = currentCycle();
    const ids = members.map((member) => member.id);
    const [scores, context] = await Promise.all([
      scoresForCycle(ids, cycle),
      performanceContext(ids, cycle),
    ]);

    return NextResponse.json({
      members: members.map((member) => {
        const score = scores.get(member.id);
        return {
          ...member,
          // Departments come out in display order, and an inactive one is
          // dropped rather than shown as a dead badge.
          departments: member.departments
            .filter((m) => m.department.isActive)
            .sort((a, b) => a.department.order - b.department.order)
            .map((m) => ({
              departmentId: m.departmentId,
              shortLabel: m.department.shortLabel,
              colorToken: m.department.colorToken,
              roleInDept: m.roleInDept as "LEAD" | "MEMBER",
              skills: parseSkills(m.skills),
            })),
          score: score?.score ?? MONTHLY_BASELINE,
          trend: score?.trend ?? null,
          // Null, not 0, when nothing has come due — the doctrine's triple has
          // to be able to say "not yet rated" without implying failure.
          onTimeRate:
            (context.get(member.id)?.judged ?? 0) > 0
              ? (context.get(member.id)?.onTimeRate ?? 0)
              : null,
          load: context.get(member.id)?.load ?? 0,
          totalWeight: context.get(member.id)?.totalWeight ?? 0,
        };
      }),
    });
  } catch {
    return apiError("Couldn't load the team", 500);
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

  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return apiError("Please fix the highlighted fields", 422, fieldErrors(parsed.error));
  }

  const { name, email, jobTitle, role, password } = parsed.data;

  try {
    const member = await prisma.user.create({
      data: {
        name,
        email,
        jobTitle,
        role,
        passwordHash: await bcrypt.hash(password, 10),
        avatarColor: avatarColorFor(email),
        isActive: true,
      },
      select: SELECT,
    });

    // The plaintext password exists only here, in the request that set it —
    // it is never stored, so this is the one chance to deliver it.
    const delivery = await sendWelcome({
      name: member.name,
      email: member.email,
      password,
      jobTitle: member.jobTitle,
    });

    return NextResponse.json({ member, welcomeEmail: delivery.status }, { status: 201 });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError("That email is already in use", 409, {
        email: "Someone already uses this email",
      });
    }
    return apiError("Couldn't create this team member", 500);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "P2002"
  );
}
