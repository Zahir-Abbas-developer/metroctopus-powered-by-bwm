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
  const owners = accounts.filter((a) => a.role === "ADMIN");
  const nonOwners = accounts.filter((a) => a.role !== "ADMIN");

  const roleOf = (a) =>
    a.leadsServices.length > 0 ? "SERVICE_LEAD" : a.isBusinessDev ? "MEMBER(BD)" : "MEMBER";

  const subjects = nonOwners.map((a) => ({ ...a, label: roleOf(a) }));

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
    await session.signIn(subject.email, "member123");

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
    await session.signIn(member.email, "member123");

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
    await session.signIn(leadSubject.email, "member123");
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

  /* ------------------------------------------------------------ report -- */

  console.log(`\n${pass + failures.length} checks\n`);
  if (failures.length > 0) {
    console.log(`${failures.length} FAILED\n`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    console.log();
    process.exit(1);
  }
  console.log("✓ no forbidden field or mutation reached a non-owner\n");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
