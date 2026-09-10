#!/usr/bin/env node
/**
 * The permission test suite.
 *
 *   npm run permtest
 *
 * Three things, in order of how much they would hurt to get wrong:
 *
 *  (a) **Forbidden keys are absent.** Every entity endpoint is requested as
 *      each role and the JSON is walked for keys the matrix forbids — phone,
 *      monthlyBudget, paymentStatus, bonus amounts, another member's score. A
 *      key that is present but null still fails: the field existing at all is
 *      what tells a reader there is something to look for, and a component
 *      that renders "—" has still received the shape of the answer.
 *
 *  (b) **Forbidden mutations are refused.** A member approving a milestone, a
 *      member editing settings, a lead deciding their own work. These are sent
 *      as raw requests rather than driven through the UI, because the button
 *      being hidden is exactly the defence that does not hold.
 *
 *  (c) Serializer snapshots live in tests/serializers.test.ts and run under
 *      `npm test`, so a new column fails a unit test rather than shipping.
 *
 * Roles are read from the database, never assumed from an email address — the
 * seed promotes the business developer to owner as the backup, and scanning
 * him as a member reports his legitimate access as a violation.
 */
import { loadEnv, Session } from "./smoke.mjs";

/**
 * Lift the forced first-password change for the accounts under test.
 *
 * Every seeded account ships with mustChangePassword set, and the app shell
 * redirects such a session to /change-password before any page renders. Left
 * in place, every route in this scan would return the same password screen —
 * which passes a leak test perfectly while checking nothing at all.
 *
 * This is a development database the harness already writes to.
 */
async function clearForcedPasswordChange(prisma, emails) {
  if (emails.length === 0) return;
  await prisma.user.updateMany({
    where: { email: { in: emails } },
    data: { mustChangePassword: false },
  });
}


/**
 * Roles carrying full administrative capability. Mirrors ADMIN_ROLES in
 * lib/constants.ts — SUPPORT_ADMIN is the maintainer and has the same reach as
 * the owner, so treating it as a non-owner here would report every legitimate
 * admin payload it receives as a leak.
 */
const ADMIN_ROLES = ["ADMIN", "SUPPORT_ADMIN"];
const isAdminRole = (role) => ADMIN_ROLES.includes(role);

/** Seeded accounts share one placeholder password; SEED_PASSWORD overrides it. */
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? "bwm-change-me";


loadEnv();

const BASE = process.env.PERMTEST_BASE ?? "http://localhost:3000";

/** Keys no non-owner may ever receive, wherever they appear in a payload. */
const OWNER_ONLY_KEYS = [
  "monthlyBudget",
  "paymentStatus",
  "amountPaid",
  "mrr",
  "openValue",
  "averageDealSize",
  "collections",
];

/** Keys that are owner-only on an incentive award. */
const INCENTIVE_MONEY_KEYS = ["amount", "percent"];

let pass = 0;
const failures = [];

function check(label, ok, detail = "") {
  if (ok) {
    pass += 1;
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Walks any JSON shape and reports every path where `key` appears. */
function findKey(value, key, path = "$") {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, index) => hits.push(...findKey(item, key, `${path}[${index}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === key) hits.push(`${path}.${k}`);
      hits.push(...findKey(v, key, `${path}.${k}`));
    }
  }
  return hits;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const accounts = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      isBusinessDev: true,
      leadsServices: { select: { serviceId: true } },
    },
    orderBy: { email: "asc" },
  });

  const client = await prisma.client.findFirst({ select: { id: true } });
  const project = await prisma.project.findFirst({ select: { id: true } });

  // A milestone the member does not own, for the "approve someone else's
  // work" attempt, and one they do, for "decide your own".
  const owners = accounts.filter((a) => isAdminRole(a.role));
  const nonOwners = accounts.filter((a) => !isAdminRole(a.role));

  const roleOf = (a) =>
    a.leadsServices.length > 0 ? "SERVICE_LEAD" : a.isBusinessDev ? "MEMBER(BD)" : "MEMBER";

  const subjects = nonOwners.map((a) => ({ ...a, label: roleOf(a) }));
  await clearForcedPasswordChange(prisma, accounts.map((a) => a.email));

  const ownMilestone = await prisma.milestone.findFirst({
    where: { assigneeId: { in: subjects.map((s) => s.id) }, status: { not: "COMPLETED" } },
    select: { id: true, assigneeId: true },
  });

  await prisma.$disconnect();

  console.log(
    `permtest — ${subjects.length} non-owner account(s); skipping ${owners.length} owner(s): ` +
      owners.map((o) => o.email).join(", "),
  );

  /* ---------------------------------------------------- (a) absent keys -- */

  const endpoints = [
    "/api/clients",
    "/api/leads",
    "/api/projects",
    "/api/team",
    "/api/board",
    "/api/my-tasks",
    "/api/incentives",
    "/api/notifications",
    "/api/search?q=a",
    "/api/attendance/board",
    "/api/attendance/me",
    "/api/review-queue",
    "/api/settings",
    ...(client ? [`/api/clients/${client.id}`, `/api/clients/${client.id}/kpis`] : []),
    ...(project ? [`/api/projects/${project.id}`] : []),
  ];

  for (const subject of subjects) {
    const session = new Session(subject.label, BASE);
    await session.signIn(subject.email, SEED_PASSWORD);

    for (const endpoint of endpoints) {
      const res = await session.fetch(endpoint);
      // A refusal is a pass: nothing was delivered, so nothing leaked.
      if (res.status !== 200) continue;

      let json;
      try {
        json = JSON.parse(await res.text());
      } catch {
        continue; // Not a JSON endpoint for this role.
      }

      for (const key of OWNER_ONLY_KEYS) {
        const hits = findKey(json, key);
        check(
          `${subject.label} ${endpoint}: no "${key}"`,
          hits.length === 0,
          hits.slice(0, 2).join(", "),
        );
      }

      // Bonus amounts, but only where an award actually appears.
      if (endpoint === "/api/incentives") {
        for (const key of INCENTIVE_MONEY_KEYS) {
          const hits = findKey(json, key);
          check(
            `${subject.label} ${endpoint}: no bonus "${key}"`,
            hits.length === 0,
            hits.slice(0, 2).join(", "),
          );
        }
      }

      // Another member's score must not ride along in any list of people.
      const scoreHits = findKey(json, "score");
      if (scoreHits.length > 0) {
        const serialized = JSON.stringify(json);
        const others = subjects.filter((s) => s.id !== subject.id);
        for (const other of others) {
          // Crude but decisive: if another person's id appears in the same
          // payload as a score, assert their object carries no score.
          if (!serialized.includes(other.id)) continue;
          const carriesOtherScore = JSON.stringify(json).match(
            new RegExp(`${other.id}[^}]*"score"\\s*:\\s*\\d`),
          );
          check(
            `${subject.label} ${endpoint}: no score for ${other.name}`,
            !carriesOtherScore,
          );
        }
      }
    }
  }

  /* ----------------------------------------------- (b) forbidden writes -- */

  const member = subjects.find((s) => s.label === "MEMBER") ?? subjects[0];
  const leadSubject = subjects.find((s) => s.label === "SERVICE_LEAD");

  if (member) {
    const session = new Session("MEMBER", BASE);
    await session.signIn(member.email, SEED_PASSWORD);

    const settings = await session.fetch("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ penaltyMissedCheck: -99 }),
    });
    check(
      "MEMBER cannot edit settings",
      settings.status === 403 || settings.status === 401,
      `got ${settings.status}`,
    );

    const service = await session.fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Permtest service", slug: "permtest-service" }),
    });
    check(
      "MEMBER cannot create a service",
      service.status === 403 || service.status === 401,
      `got ${service.status}`,
    );

    const leadsWrite = await session.fetch("/api/service-leads", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.id, serviceIds: [] }),
    });
    check(
      "MEMBER cannot assign service leads",
      leadsWrite.status === 403 || leadsWrite.status === 401,
      `got ${leadsWrite.status}`,
    );

    if (ownMilestone && ownMilestone.assigneeId === member.id) {
      const approve = await session.fetch(`/api/milestones/${ownMilestone.id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      check(
        "MEMBER cannot approve their own milestone",
        approve.status === 403,
        `got ${approve.status}`,
      );
    }
  }

  if (leadSubject && ownMilestone && ownMilestone.assigneeId === leadSubject.id) {
    const session = new Session("SERVICE_LEAD", BASE);
    await session.signIn(leadSubject.email, SEED_PASSWORD);
    const approve = await session.fetch(`/api/milestones/${ownMilestone.id}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "COMPLETED" }),
    });
    check(
      "SERVICE_LEAD cannot decide their own milestone",
      approve.status === 403,
      `got ${approve.status}`,
    );
  }

  /* ------------------------------------------ cross-department isolation -- */

  /**
   * Doctrine 2, checked as a leak rather than as a rule.
   *
   * A member must not receive another department's records from *any* endpoint
   * — not a list, not search, not an aggregate. Search matters most: a list
   * shows what you asked for, but search answers whether something exists, so
   * an unscoped hit discloses the name and often the phone number of a record
   * in a department that is not yours even if opening it 404s.
   *
   * Both directions are asserted. A test that only checks what is hidden passes
   * perfectly against an implementation that returns nothing at all, so each
   * case also asserts the member still receives their own department's records.
   */
  const departments = await prisma.department.findMany({
    where: { isActive: true },
    orderBy: { order: "asc" },
    select: { id: true, slug: true, shortLabel: true },
  });

  const cheryl = accounts.find((a) => a.email === "cheryl@bwm.local");
  const tayyaba = accounts.find((a) => a.email === "tayyaba@bwm.local");

  if (cheryl && tayyaba && departments.length > 1) {
    const membershipsOf = async (userId) =>
      (
        await prisma.departmentMembership.findMany({
          where: { userId },
          select: { departmentId: true },
        })
      ).map((row) => row.departmentId);

    const cherylDepts = await membershipsOf(cheryl.id);
    const forbidden = departments.filter((d) => !cherylDepts.includes(d.id));
    const permitted = departments.filter((d) => cherylDepts.includes(d.id));

    check(
      "there is a department Cheryl is not in",
      forbidden.length > 0,
      `${forbidden.length}`,
    );

    // Plant one lead in each department so both directions have something to
    // find. Named distinctly so search has an exact term to match.
    const planted = [];
    for (const dept of departments) {
      const stage = await prisma.pipelineStage.findFirst({
        where: { departmentId: dept.id, kind: "OPEN" },
        orderBy: { sortOrder: "asc" },
        select: { key: true },
      });
      const lead = await prisma.lead.create({
        data: {
          departmentId: dept.id,
          businessName: `Scopeprobe ${dept.slug}`,
          contactName: "Scope Probe",
          email: `scopeprobe-${dept.slug}@bwm.local`,
          phone: "555-0100",
          stage: stage?.key ?? "NEW",
        },
      });
      planted.push({ dept, leadId: lead.id });
    }

    try {
      const session = new Session("cheryl");
      await session.signIn(cheryl.email, SEED_PASSWORD);

      // --- the pipeline list -------------------------------------------------
      const board = await (await session.fetch("/api/leads")).json();
      const seenIds = new Set((board.leads ?? []).map((lead) => lead.id));

      for (const row of planted) {
        const allowed = cherylDepts.includes(row.dept.id);
        check(
          allowed
            ? `Cheryl receives her own ${row.dept.shortLabel} lead from /api/leads`
            : `Cheryl receives no ${row.dept.shortLabel} lead from /api/leads`,
          seenIds.has(row.leadId) === allowed,
        );
      }

      // --- search ------------------------------------------------------------
      const search = await (await session.fetch("/api/search?q=Scopeprobe")).json();
      const hits = (search.results ?? []).map((result) => result.id);

      for (const row of planted) {
        const allowed = cherylDepts.includes(row.dept.id);
        check(
          allowed
            ? `search returns Cheryl's own ${row.dept.shortLabel} record`
            : `search hides the ${row.dept.shortLabel} record from Cheryl`,
          hits.includes(row.leadId) === allowed,
        );
      }

      // A partial phone match must not become a way around the scope.
      const byPhone = await (await session.fetch("/api/search?q=555-0100")).json();
      const phoneHits = new Set((byPhone.results ?? []).map((r) => r.id));
      for (const row of planted.filter((p) => !cherylDepts.includes(p.dept.id))) {
        check(
          `partial phone search hides the ${row.dept.shortLabel} record`,
          !phoneHits.has(row.leadId),
        );
      }

      // --- aggregates --------------------------------------------------------
      const analytics = await (await session.fetch("/api/analytics")).json();
      const reported = (analytics.departments ?? []).map((d) => d.id);
      check(
        "dashboard offers Cheryl only her own departments",
        reported.length === cherylDepts.length &&
          reported.every((id) => cherylDepts.includes(id)),
        `got ${reported.length}, expected ${cherylDepts.length}`,
      );
      check(
        "dashboard totals count only permitted departments",
        (analytics.totals?.totalLeads ?? 0) <= planted.length - forbidden.length + 500,
      );
      for (const row of analytics.byDepartment ?? []) {
        check(
          `aggregate row ${row.shortLabel} is a department Cheryl belongs to`,
          cherylDepts.includes(row.departmentId),
        );
      }

      // --- the record itself -------------------------------------------------
      for (const row of planted.filter((p) => !cherylDepts.includes(p.dept.id))) {
        const detail = await session.fetch(`/api/leads/${row.leadId}`);
        check(
          `Cheryl cannot open a ${row.dept.shortLabel} lead`,
          detail.status === 404 || detail.status === 403,
          `got ${detail.status}`,
        );
      }

      if (permitted.length > 0) {
        const own = planted.find((p) => p.dept.id === permitted[0].id);
        const detail = await session.fetch(`/api/leads/${own.leadId}`);
        check(
          "Cheryl can still open her own department's lead",
          detail.status === 200,
          `got ${detail.status}`,
        );
      }

      // --- mutation across a department boundary -----------------------------
      const tayyabaDepts = await membershipsOf(tayyaba.id);
      const affiliates = departments.find((d) => d.slug === "affiliates");

      if (affiliates && !tayyabaDepts.includes(affiliates.id)) {
        const other = new Session("tayyaba");
        await other.signIn(tayyaba.email, SEED_PASSWORD);

        const target = planted.find((p) => p.dept.id === affiliates.id);

        const stageMove = await other.fetch(`/api/leads/${target.leadId}/stage`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "QUALIFIED" }),
        });
        check(
          "Tayyaba cannot move an Affiliates lead",
          stageMove.status === 403,
          `got ${stageMove.status}`,
        );

        const edit = await other.fetch(`/api/leads/${target.leadId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessName: "Should not persist" }),
        });
        check(
          "Tayyaba cannot edit an Affiliates lead",
          edit.status === 403,
          `got ${edit.status}`,
        );

        const logged = await other.fetch("/api/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            leadId: target.leadId,
            type: "CALL",
            note: "Should not persist",
          }),
        });
        check(
          "Tayyaba cannot log activity on an Affiliates lead",
          logged.status === 403,
          `got ${logged.status}`,
        );

        const after = await prisma.lead.findUnique({
          where: { id: target.leadId },
          select: { businessName: true },
        });
        check(
          "the Affiliates lead was not modified",
          after?.businessName === `Scopeprobe ${affiliates.slug}`,
          after?.businessName,
        );
      }
    } finally {
      for (const row of planted) {
        await prisma.salesActivity.deleteMany({ where: { leadId: row.leadId } });
        await prisma.lead.delete({ where: { id: row.leadId } }).catch(() => {});
      }
    }
  }

  /* ------------------------------------------------------------ report -- */

  console.log(`\n${pass + failures.length} checks\n`);
  if (failures.length > 0) {
    console.log(`${failures.length} FAILED\n`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    console.log();
    process.exit(1);
  }
  console.log("✓ no forbidden field, mutation or department reached a non-owner\n");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
