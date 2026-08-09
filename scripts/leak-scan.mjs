#!/usr/bin/env node
/**
 * Does owner-only data actually leave the server?
 *
 * The Production Doctrine's permission matrix is enforced server-side, which
 * means the test cannot be "is the number on screen". A component that hides a
 * field still received it: the value sits in the RSC payload or the JSON body,
 * one network-tab click away from anyone who wants it. The only honest check is
 * to read every byte the server sends and look for values that should never
 * have been in it.
 *
 * So this signs in as each real member of the roster, requests every page and
 * every GET endpoint, and searches the raw response for sentinel values taken
 * from the database — a client's phone number, a retainer figure, a lead's deal
 * size, another member's score. A hit is a leak, whether or not it is rendered.
 *
 *   npm run leaks
 */
import { discoverRoutes, loadEnv, Session } from "./smoke.mjs";
import { readdirSync, statSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.LEAK_BASE ?? "http://localhost:3000";

/** Walks /app/api collecting every route.ts that exports a GET. */
function discoverApiRoutes(dir = path.join(ROOT, "app", "api"), prefix = "/api") {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    const next = `${prefix}/${entry}`;
    const file = path.join(full, "route.ts");
    if (existsSync(file) && /export\s+async\s+function\s+GET/.test(readFileSync(file, "utf8"))) {
      routes.push(next);
    }
    routes.push(...discoverApiRoutes(full, next));
  }
  return routes;
}

async function main() {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  const clients = await prisma.client.findMany({
    select: { id: true, businessName: true, phone: true, monthlyBudget: true },
  });
  const leads = await prisma.lead.findMany({
    select: { businessName: true, estimatedMonthlyValue: true, owner: { select: { email: true } } },
  });
  const members = await prisma.user.findMany({
    where: { role: "MEMBER" },
    select: { id: true, name: true, email: true },
  });

  /* Roles are read from the database, never assumed from an address.
     saad@agency.local looks like a member and is promoted to ADMIN by the seed
     as the backup owner — scanning him as a member reported his entirely
     legitimate access to a client record as a leak. An owner cannot leak to
     themselves, so owners are excluded and said so out loud. */
  const accounts = await prisma.user.findMany({
    select: {
      email: true,
      role: true,
      isBusinessDev: true,
      leadsServices: { select: { serviceId: true } },
      leads: { where: { stage: { notIn: ["WON", "LOST"] } }, select: { id: true } },
    },
    orderBy: { email: "asc" },
  });
  const project = await prisma.project.findFirst({ select: { id: true } });
  const report = await prisma.report.findFirst({ select: { id: true } });

  /* Sentinels: values the matrix says a given role must never receive.
     Numbers are matched as whole words so a budget of 3000 does not collide
     with an unrelated 30000 or a timestamp. */
  const sentinels = [];
  for (const client of clients) {
    if (client.phone) {
      sentinels.push({ label: `phone of ${client.businessName}`, needle: client.phone, kind: "phone" });
    }
    sentinels.push({
      label: `retainer of ${client.businessName} (${client.monthlyBudget})`,
      needle: String(client.monthlyBudget),
      kind: "retainer",
      numeric: true,
    });
  }
  for (const lead of leads) {
    if (lead.estimatedMonthlyValue) {
      sentinels.push({
        label: `deal value of ${lead.businessName} (${lead.estimatedMonthlyValue})`,
        needle: String(lead.estimatedMonthlyValue),
        kind: "deal",
        numeric: true,
        /* A business developer is *supposed* to see the deals they own — it is
           what their targets are measured against. Without this exception a
           correct implementation fails the scan, and the obvious way to make
           it pass is to withhold data the matrix grants. */
        allowedForEmail: lead.owner?.email ?? null,
      });
    }
  }

  await prisma.$disconnect();

  const ids = {
    "/clients/[id]": clients[0]?.id ?? null,
    "/projects/[id]": project?.id ?? null,
    "/reports/[id]": report?.id ?? null,
    "/team/[id]": members[0]?.id ?? null,
  };

  const pages = discoverRoutes()
    .sort()
    .filter((r) => r !== "/login" && r !== "/");
  const apis = discoverApiRoutes().sort();

  const owners = accounts.filter((a) => a.role === "ADMIN");
  const nonOwners = accounts.filter((a) => a.role !== "ADMIN");

  const roles = nonOwners.map((account) => ({
    name:
      account.leadsServices.length > 0
        ? "SERVICE_LEAD"
        : account.isBusinessDev
          ? "MEMBER(BD)"
          : "MEMBER",
    email: account.email,
    password: "member123",
    isBd: account.isBusinessDev,
  }));

  console.log(
    `scanning ${roles.length} non-owner account(s); skipping ${owners.length} owner(s): ` +
      owners.map((o) => o.email).join(", "),
  );

  const bdWithPipeline = nonOwners.find((a) => a.isBusinessDev && a.leads.length > 0);

  /* A scan that only looks for leaks passes perfectly if every endpoint
     returns nothing. These are the values that must still arrive, so
     over-restriction fails as loudly as a leak. */
  const grants = [];

  const findings = [];
  let scanned = 0;

  for (const role of roles) {
    const session = new Session(role.name, BASE);
    await session.signIn(role.email, role.password);

    const targets = [
      ...pages.map((route) => ({
        route,
        url: route.includes("[") ? (ids[route] ? route.replace(/\[[^\]]+\]/, ids[route]) : null) : route,
      })),
      ...apis.map((route) => ({ route, url: route.includes("[") ? null : route })),
    ].filter((t) => t.url);

    for (const target of targets) {
      let body = "";
      let status = 0;
      try {
        const res = await session.fetch(target.url);
        status = res.status;
        // Only a delivered body can leak. A redirect carries nothing.
        if (status !== 200) continue;
        body = await res.text();
      } catch {
        continue;
      }
      scanned += 1;

      for (const sentinel of sentinels) {
        /* Numbers must not match inside an identifier. Every id in this app is
           a cuid, and `cmskxqqc3000mvhgt…` contains "3000" flanked by letters
           — which reported a retainer leak on three endpoints that were clean.
           Excluding letters as well as digits is the difference between a
           detector and a random-number generator. */
        const hit = sentinel.numeric
          ? new RegExp(`(?<![A-Za-z0-9.])${sentinel.needle}(?![A-Za-z0-9.])`).test(body)
          : body.includes(sentinel.needle);

        // Owned deals are this person's to see; record that they arrived.
        const hitGrant = Boolean(role.isBd) && sentinel.allowedForEmail === role.email;

        if (hit && hitGrant) {
          grants.push({ role: role.name, url: target.url, sentinel: sentinel.label });
          continue;
        }
        if (hit) {
          findings.push({ role: role.name, url: target.url, sentinel: sentinel.label, kind: sentinel.kind });
        }
      }
    }
    console.log(`  scanned ${role.name}`);
  }

  console.log(`\n${scanned} responses scanned, ${sentinels.length} sentinels each`);

  /* The BD must actually receive their own pipeline on /api/leads. If nothing
     was granted, the matrix has been implemented as "deny everything", which
     passes a leak test and breaks the product. */
  if (!bdWithPipeline) {
    // Not a pass and not a failure — a gap in the data being scanned, which
    // is worth saying rather than hiding behind a green tick.
    console.log(
      "\n! grant check skipped: no non-owner business developer with open leads in this database,\n" +
        "  so the \"a BD sees their own deals\" path is covered by unit tests only.",
    );
  } else if (!grants.some((g) => g.url === "/api/leads")) {
    console.log(
      `\n✗ OVER-RESTRICTED: ${bdWithPipeline.email} owns open leads but received none of their values on /api/leads\n`,
    );
    process.exit(1);
  } else {
    console.log(`${grants.length} legitimate grant(s) confirmed — BD sees their own deals\n`);
  }

  if (findings.length === 0) {
    console.log("✓ no owner-only value reached a non-owner\n");
    process.exit(0);
  }

  // Group so one leaky endpoint is one line, not forty.
  const grouped = new Map();
  for (const f of findings) {
    const key = `${f.role} ${f.url}`;
    grouped.set(key, [...(grouped.get(key) ?? []), f]);
  }

  console.log(`${grouped.size} leaking responses:\n`);
  for (const [key, hits] of [...grouped.entries()].sort()) {
    const kinds = [...new Set(hits.map((h) => h.kind))].join(", ");
    console.log(`  ✗ ${key}`);
    console.log(`      ${hits.length} sentinel(s) — ${kinds}`);
    for (const hit of hits.slice(0, 3)) console.log(`      · ${hit.sentinel}`);
  }
  console.log();
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
