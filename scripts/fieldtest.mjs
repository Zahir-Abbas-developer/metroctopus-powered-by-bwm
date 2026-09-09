/**
 * T2 — the department field engine, checked end to end over HTTP.
 *
 * The three claims this phase makes are all claims about a *response*, not
 * about a component, so they are checked against the bytes the server sends:
 *
 *   1. A department's form offers only that department's fields.
 *   2. Its assignee list contains only that department's members.
 *   3. A member is not offered — and cannot use — a department they are not in.
 *
 * Run against a live server: `npm run fieldtest`.
 *
 * Like permtest and leak-scan, this clears `mustChangePassword` on the accounts
 * it signs in as. Every seeded account carries the flag and the app shell
 * redirects to the change-password screen before any surface renders, so
 * without this every request under test would be answered by that screen — and
 * a suite that receives the same page for every check passes while verifying
 * nothing.
 */

import { loadEnv, Session, waitForServer } from "./smoke.mjs";

loadEnv();

const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "bwm-change-me";

const ADMIN = "coachd@bwm.local";
/** Two departments: Pilot Cars and Life & Health. Not Affiliates, not Culture Plus. */
const MEMBER = "tayyaba@bwm.local";

let failures = 0;
let checks = 0;

function check(ok, label, detail = "") {
  checks += 1;
  if (ok) return true;
  failures += 1;
  console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  return false;
}

async function main() {
  await waitForServer();

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    await prisma.user.updateMany({
      where: { email: { in: [ADMIN, MEMBER] } },
      data: { mustChangePassword: false },
    });

    const departments = await prisma.department.findMany({
      where: { isActive: true },
      orderBy: { order: "asc" },
      include: { memberships: { select: { userId: true } } },
    });

    // ---------------------------------------------------------------- admin --
    const admin = new Session("admin");
    await admin.signIn(ADMIN, SEED_PASSWORD);

    const creatable = await (await admin.fetch("/api/departments/creatable")).json();
    check(
      creatable.departments?.length === departments.length,
      "admin may create in every department",
      `got ${creatable.departments?.length}, expected ${departments.length}`,
    );

    const created = [];

    for (const department of departments) {
      const form = await (
        await admin.fetch(`/api/departments/${department.id}/form?entity=LEAD`)
      ).json();

      // 1. Only this department's fields.
      const foreign = (form.fields ?? []).filter((f) => f.departmentId !== department.id);
      check(
        foreign.length === 0,
        `${department.shortLabel}: form offers only its own fields`,
        foreign.map((f) => f.key).join(", "),
      );
      check(
        (form.fields ?? []).length > 0,
        `${department.shortLabel}: has field definitions`,
      );

      // 2. Only this department's members, and every one of them.
      const memberIds = new Set(department.memberships.map((m) => m.userId));
      const offered = (form.assignees ?? []).map((a) => a.userId);
      check(
        offered.every((id) => memberIds.has(id)),
        `${department.shortLabel}: assignees are all members`,
        offered.filter((id) => !memberIds.has(id)).join(", "),
      );
      check(
        offered.length === memberIds.size,
        `${department.shortLabel}: every member is offered`,
        `got ${offered.length}, expected ${memberIds.size}`,
      );

      // Stages come from this department's pipeline, not a constant.
      check(
        (form.stages ?? []).length > 0,
        `${department.shortLabel}: has pipeline stages`,
      );

      // 3. Create a lead, answering every required field.
      const fieldValues = {};
      for (const field of form.fields ?? []) {
        if (!field.required) continue;
        fieldValues[field.key] =
          field.type === "SELECT" ? (field.options[0] ?? "") : `check-${field.key}`;
      }

      const response = await admin.fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: department.id,
          businessName: `Fieldtest ${department.shortLabel}`,
          contactName: "Harness Contact",
          email: "harness@bwm.local",
          source: "OUTREACH",
          fieldValues,
        }),
      });

      const body = await response.json().catch(() => ({}));
      const ok = check(
        response.status === 201,
        `${department.shortLabel}: lead created`,
        `${response.status} ${JSON.stringify(body.fields ?? body.error ?? "")}`,
      );

      if (ok) {
        created.push(body.lead.id);

        // The opening stage must be one this department actually has — a
        // hardcoded "NEW" would file an Affiliates lead into a column that
        // department's board never renders.
        const stageKeys = (form.stages ?? []).map((s) => s.key);
        check(
          stageKeys.includes(body.lead.stage),
          `${department.shortLabel}: opened at one of its own stages`,
          `${body.lead.stage} not in [${stageKeys.join(", ")}]`,
        );

        // Answers were persisted against this department's definitions.
        const stored = await prisma.fieldValue.findMany({
          where: { recordId: body.lead.id },
          include: { definition: { select: { departmentId: true, key: true } } },
        });
        check(
          stored.length === Object.keys(fieldValues).length,
          `${department.shortLabel}: answers persisted`,
          `stored ${stored.length}, sent ${Object.keys(fieldValues).length}`,
        );
        check(
          stored.every((row) => row.definition.departmentId === department.id),
          `${department.shortLabel}: answers bound to its own definitions`,
        );
      }
    }

    // --------------------------------------------------------------- member --
    const member = new Session("member");
    await member.signIn(MEMBER, SEED_PASSWORD);

    const mine = await (await member.fetch("/api/departments/creatable")).json();
    const myIds = (mine.departments ?? []).map((d) => d.id);
    const myMemberships = await prisma.departmentMembership.findMany({
      where: { user: { email: MEMBER } },
      select: { departmentId: true },
    });
    const expected = new Set(myMemberships.map((m) => m.departmentId));

    check(
      myIds.length === expected.size && myIds.every((id) => expected.has(id)),
      "member is offered exactly their own departments",
      `got ${myIds.length}, expected ${expected.size}`,
    );

    const forbidden = departments.filter((d) => !expected.has(d.id));
    check(forbidden.length > 0, "there is a department the member is not in");

    for (const department of forbidden) {
      check(
        !myIds.includes(department.id),
        `${department.shortLabel} absent from the member's options`,
      );

      // Absent from the picker is not enough — the route must refuse it too.
      const blocked = await member.fetch(
        `/api/departments/${department.id}/form?entity=LEAD`,
      );
      check(
        blocked.status === 403,
        `${department.shortLabel}: form refused to a non-member`,
        `status ${blocked.status}`,
      );

      const write = await member.fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: department.id,
          businessName: "Should not exist",
          contactName: "Should not exist",
          source: "OUTREACH",
          fieldValues: {},
        }),
      });
      check(
        write.status === 403,
        `${department.shortLabel}: creation refused to a non-member`,
        `status ${write.status}`,
      );
    }

    // Leave the database as it was found.
    for (const id of created) {
      await prisma.fieldValue.deleteMany({ where: { recordId: id } });
      await prisma.lead.delete({ where: { id } }).catch(() => {});
    }

    console.log(`\n${checks} checks`);
    if (failures === 0) {
      console.log("\n✓ every department offered only its own fields and its own people\n");
    } else {
      console.error(`\n✗ ${failures} of ${checks} checks failed\n`);
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
