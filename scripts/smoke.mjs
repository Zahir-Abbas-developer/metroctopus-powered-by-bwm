#!/usr/bin/env node
/**
 * Route smoke test: every page, every role, asserted to render.
 *
 * Run it with `npm run smoke`.
 *
 * The routes are discovered by walking /app rather than listed here. A
 * hardcoded list is a list that rots: the page someone adds next month is
 * exactly the page nobody remembers to add to the test, and it would pass
 * green while being broken. Anything with a page.tsx is covered the day it
 * lands.
 *
 * What each route is expected to do comes from lib/routes.ts, the same module
 * the middleware and the sidebar use. A member opening an admin route is
 * supposed to be redirected, so asserting a flat 200 everywhere would either
 * fail on correct behaviour or force the expectation to be duplicated here and
 * kept in step by hand.
 *
 * Modes:
 *   npm run smoke          against the current database
 *   npm run smoke:empty    against a throwaway database with no business data
 *
 * The empty run is the one that catches "this page assumes a client has a
 * project". It builds its own SQLite file in a temp directory, seeds the
 * roster and nothing else, and never touches prisma/dev.db.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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


const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Next and the Prisma CLI both read .env for you; a plain node script does
 * not. Without this the suite starts up with no DATABASE_URL and fails in a
 * way that looks like a database problem rather than a missing variable.
 */
export function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, "");
  }
}
loadEnv();
const EMPTY = process.argv.includes("--empty");
const PORT = Number(process.env.SMOKE_PORT ?? (EMPTY ? 3011 : 3010));
const BASE = process.env.SMOKE_BASE ?? `http://localhost:${PORT}`;
const EXTERNAL = Boolean(process.env.SMOKE_BASE);

export const ADMIN = { email: "smoke-admin@bwm.local", password: "smoke-admin-123" };
export const MEMBER = { email: "smoke-member@bwm.local", password: "smoke-member-123" };
export const LEAD = { email: "smoke-lead@bwm.local", password: "smoke-lead-123" };

/* ---------------------------------------------------------------- routes -- */

/** Walks /app collecting every route that has a page.tsx. */
export function discoverRoutes(dir = path.join(ROOT, "app"), prefix = "") {
  const routes = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry.startsWith("_") || entry === "api") continue;

    // (group) folders organise files without appearing in the URL.
    const segment = entry.startsWith("(") && entry.endsWith(")") ? "" : `/${entry}`;
    const next = `${prefix}${segment}`;
    if (existsSync(path.join(full, "page.tsx"))) routes.push(next === "" ? "/" : next);
    routes.push(...discoverRoutes(full, next));
  }
  return routes;
}

/* ------------------------------------------------------------------ http -- */

export class Session {
  /** `base` is a parameter so another runner can drive a different port. */
  constructor(label, base = BASE) {
    this.label = label;
    this.base = base;
    this.jar = new Map();
  }
  get cookie() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async fetch(pathname, init = {}) {
    const res = await fetch(this.base + pathname, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), cookie: this.cookie },
    });
    for (const raw of res.headers.getSetCookie()) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      this.jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    return res;
  }
  async signIn(email, password) {
    const { csrfToken } = await (await this.fetch("/api/auth/csrf")).json();
    await this.fetch("/api/auth/callback/credentials", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrfToken, email, password, json: "true" }).toString(),
    });
    if (![...this.jar.keys()].some((k) => k.includes("session-token"))) {
      throw new Error(`could not sign in as ${email}`);
    }
  }
}

/**
 * The error boundary's headline. If this string ever changes in
 * app/(app)/error.tsx it must change here too — the test asserting a page
 * rendered is worth nothing if it is looking for text that no longer exists,
 * so the suite checks the source file for it at startup.
 */
export const BOUNDARY_MARKERS = ["This page didn&#x27;t load", "This page didn't load", "This page didn’t load"];

export function looksBroken(html) {
  return BOUNDARY_MARKERS.some((marker) => html.includes(marker));
}

/* ----------------------------------------------------------------- server -- */

export function waitForServer(timeoutMs = 120_000, base = BASE) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(`${base}/login`, { redirect: "manual" });
        if (res.status < 500) return resolve();
      } catch { /* not listening yet */ }
      if (Date.now() - started > timeoutMs) return reject(new Error("server never became ready"));
      setTimeout(tick, 400);
    };
    tick();
  });
}

export function startServer(env, port = PORT) {
  const child = spawn("npx", ["next", "dev", "--port", String(port)], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (b) => log.push(b.toString()));
  child.stderr.on("data", (b) => log.push(b.toString()));
  return { child, log };
}

/* ------------------------------------------------------------------- main -- */

/**
 * Removes the accounts this suite created.
 *
 * Against the throwaway database of `--empty` this is redundant, but against
 * the developer's own database it is the difference between a test and a mess:
 * without it, three invented people accumulate on /team, in the attendance
 * board and in every member dropdown, and they look exactly like real
 * teammates who forgot to clock in.
 */
export async function cleanupDatabase(databaseUrl) {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.user.deleteMany({
      where: { email: { in: [ADMIN.email, MEMBER.email, LEAD.email] } },
    });
  } catch {
    // Best effort. A failure to tidy up must not fail the run that passed.
  } finally {
    await prisma.$disconnect();
  }
}

export async function prepareDatabase(databaseUrl) {
  const { PrismaClient } = await import("@prisma/client");
  const bcrypt = (await import("bcryptjs")).default;
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

  const ensure = async (creds, role, jobTitle) => {
    const passwordHash = await bcrypt.hash(creds.password, 10);
    return prisma.user.upsert({
      where: { email: creds.email },
      update: { passwordHash, role, isActive: true },
      create: {
        email: creds.email,
        name: `Smoke ${role}`,
        passwordHash,
        role,
        jobTitle,
        avatarColor: "#1A6B3A",
        isActive: true,
      },
    });
  };

  await ensure(ADMIN, "ADMIN", "Smoke owner");
  await ensure(MEMBER, "MEMBER", "Smoke member");
  const lead = await ensure(LEAD, "MEMBER", "Smoke service lead");

  // The lead role only exists if the person actually leads a service, so give
  // them one — otherwise "SERVICE_LEAD" in the report would be a plain member
  // and the delegated-approval paths would go untested.
  const service = await prisma.serviceCatalog.findFirst({ orderBy: { order: "asc" } });
  if (service) {
    await prisma.serviceLead.upsert({
      where: { userId_serviceId: { userId: lead.id, serviceId: service.id } },
      update: {},
      create: { userId: lead.id, serviceId: service.id },
    });
  }

  // Real ids for the [id] routes. Null where the table is empty — an empty
  // database has no client to open, and that is a skip, not a failure.
  const [client, project, report, member] = await Promise.all([
    prisma.client.findFirst({ select: { id: true } }),
    prisma.project.findFirst({ select: { id: true } }),
    prisma.report.findFirst({ select: { id: true } }),
    prisma.user.findFirst({ where: { role: "MEMBER" }, select: { id: true } }),
  ]);

  await prisma.$disconnect();
  return {
    "/clients/[id]": client?.id ?? null,
    "/projects/[id]": project?.id ?? null,
    "/reports/[id]": report?.id ?? null,
    "/team/[id]": member?.id ?? null,
  };
}

async function main() {
  let databaseUrl = process.env.DATABASE_URL;
  let tempDir = null;

  if (EMPTY) {
    tempDir = mkdtempSync(path.join(tmpdir(), "bwm-smoke-"));
    databaseUrl = `file:${path.join(tempDir, "smoke.db")}`;
    console.log("Building an empty database (roster only, no business data)…");
    const push = spawn("npx", ["prisma", "db", "push", "--skip-generate", "--accept-data-loss"], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: "ignore",
    });
    await new Promise((res, rej) =>
      push.on("exit", (code) => (code === 0 ? res() : rej(new Error("prisma db push failed")))),
    );
  }

  const ids = await prepareDatabase(databaseUrl);

  let server = null;
  if (!EXTERNAL) {
    console.log(`Starting a server on :${PORT}…`);
    server = startServer({ DATABASE_URL: databaseUrl });
    try {
      await waitForServer();
    } catch (error) {
      console.error(server.log.join("").slice(-3000));
      throw error;
    }
  }

  // The same module the middleware and the sidebar use, so "who may open
  // what" has exactly one definition. Its only import is `import type`, which
  // tsx erases — nothing here needs the @/ alias resolved at runtime.
  const { navItemsForRole, isAdminRoute, NAV_ITEMS } = await import("../lib/routes.ts");

  // Guard the guard: if the boundary's headline is edited, every assertion
  // below silently stops detecting anything. Fail loudly instead.
  const boundarySource = await import("node:fs").then((fs) =>
    fs.readFileSync(path.join(ROOT, "app", "(app)", "error.tsx"), "utf8"),
  );
  if (!BOUNDARY_MARKERS.some((m) => boundarySource.includes(m.replace(/&#x27;/g, "'")))) {
    console.error(
      "The error boundary's headline no longer matches BOUNDARY_MARKERS in this file.\n" +
        "Update it, or every route below would pass while rendering the boundary.",
    );
    process.exit(1);
  }

  const discovered = discoverRoutes().sort();
  const routes = discovered.filter((r) => r !== "/login" && r !== "/");

  const roles = [
    { name: "ADMIN", creds: ADMIN, role: "ADMIN" },
    { name: "SERVICE_LEAD", creds: LEAD, role: "MEMBER" },
    { name: "MEMBER", creds: MEMBER, role: "MEMBER" },
  ];

  const failures = [];
  const skipped = [];
  let checks = 0;

  console.log(
    `\n${routes.length} routes × ${roles.length} roles — ${EMPTY ? "EMPTY" : "CURRENT"} database\n`,
  );

  for (const role of roles) {
    const session = new Session(role.name);
    await session.signIn(role.creds.email, role.creds.password);

    const allowed = new Set(navItemsForRole(role.role).map((item) => item.href));

    for (const route of routes) {
      const dynamic = route.includes("[");
      const id = dynamic ? ids[route] : null;
      if (dynamic && !id) {
        skipped.push(`${role.name} ${route} (nothing in the database to open)`);
        continue;
      }
      const url = dynamic ? route.replace(/\[[^\]]+\]/, id) : route;

      const res = await session.fetch(url);
      const html = res.status === 200 ? await res.text() : "";
      checks += 1;

      const adminOnly = isAdminRoute(route) && !allowed.has(route);
      const redirected = res.status >= 300 && res.status < 400;

      /* /reports is `scope: "exact"` — the listing is the owner's, but a
         member may open /reports/<id> for a report that belongs to them. The
         smoke accounts own no reports, so the id under test is always someone
         else's, and the only correct outcome is a refusal. Asserting that is
         more useful than skipping: it is the check that would catch one
         member being able to read another's review. */
      if (route === "/reports/[id]" && !isAdminRole(role.role)) {
        if (res.status === 200) {
          failures.push(`${role.name} ${url}: could open another member's report`);
        }
        continue;
      }

      if (adminOnly && !isAdminRole(role.role)) {
        // Being turned away is the correct outcome — but it has to be a
        // redirect, not a crash and not a silent 200.
        if (!redirected) {
          failures.push(`${role.name} ${url}: expected a redirect away, got ${res.status}`);
        }
        continue;
      }

      /* Two routes redirect by design rather than rendering.
         
         /settings is an index with no screen of its own and forwards to its
         first tab. /change-password only shows the forced password form while
         the flag is set, and sends everyone else on — the smoke accounts have
         already got real passwords, so being forwarded is the correct result
         and asserting it is what proves the gate lifts once it is satisfied. */
      const REDIRECTS_BY_DESIGN = {
        "/settings": "/settings/",
        "/change-password": "/dashboard",
      };
      const expectedTarget = REDIRECTS_BY_DESIGN[route];
      if (expectedTarget) {
        const location = res.headers.get("location") ?? "";
        if (!redirected || !location.includes(expectedTarget)) {
          failures.push(
            `${role.name} ${url}: expected a redirect to ${expectedTarget}, got ${res.status} ${location}`,
          );
        }
        continue;
      }

      if (redirected) {
        failures.push(
          `${role.name} ${url}: unexpected redirect to ${res.headers.get("location")}`,
        );
        continue;
      }
      if (res.status !== 200) {
        failures.push(`${role.name} ${url}: HTTP ${res.status}`);
        continue;
      }
      if (looksBroken(html)) {
        failures.push(`${role.name} ${url}: rendered the error boundary`);
        continue;
      }
    }
    /* "/" is a bare redirect to the landing route, so it is not in the list
       above — a redirect would be scored as a failure there. It still has to
       work: it is where a signed-in user lands from a bookmark. */
    const root = await session.fetch("/");
    checks += 1;
    const rootTarget = root.headers.get("location") ?? "";
    if (root.status < 300 || root.status >= 400 || !rootTarget.includes("/dashboard")) {
      failures.push(`${role.name} /: expected a redirect to /dashboard, got ${root.status} ${rootTarget}`);
    }

    console.log(`  ${role.name.padEnd(13)} ${routes.length} routes checked`);
  }

  /* Doctrine 5: a parked module must be *absent*, not merely empty.
     
     Two things are asserted for every module that is switched off: that none
     of its nav entries appear in the rail, and that its routes still answer
     with the disabled screen rather than the live feature or a crash. The
     first is the one that regresses quietly — a nav item is easy to leave
     behind, and nobody notices until a member clicks it. */
  {
    const { MODULES } = await import("../lib/modules.ts");
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });

    let row;
    try {
      row = await prisma.settings.upsert({
        where: { id: "singleton" },
        update: {},
        create: { id: "singleton" },
      });
    } finally {
      await prisma.$disconnect();
    }

    const session = new Session("MODULES");
    await session.signIn(ADMIN.email, ADMIN.password);
    const railHtml = await (await session.fetch("/dashboard")).text();

    for (const mod of MODULES) {
      const enabled = Boolean(row[mod.field]);
      checks += 1;
      if (enabled) continue;

      for (const key of mod.navKeys) {
        const item = NAV_ITEMS.find((i) => i.key === key);
        if (item && railHtml.includes(`href="${item.href}"`)) {
          failures.push(
            `module ${mod.key} is off but the rail still links ${item.href}`,
          );
        }
      }

      for (const prefix of mod.routePrefixes) {
        const res = await session.fetch(prefix);
        checks += 1;
        if (res.status !== 200) {
          failures.push(`module ${mod.key} is off: ${prefix} returned HTTP ${res.status}`);
          continue;
        }
        const html = await res.text();
        if (looksBroken(html)) {
          failures.push(`module ${mod.key} is off: ${prefix} rendered the error boundary`);
        } else if (!html.includes("Module disabled")) {
          failures.push(
            `module ${mod.key} is off but ${prefix} rendered the live feature`,
          );
        }
      }
    }

    console.log(
      `  ${"MODULES".padEnd(13)} ${MODULES.filter((m) => !row[m.field]).length} parked module(s) verified absent`,
    );
  }

  /* An API route frozen at build time serves the same stale body for the life
     of the deployment. It is invisible to every request-level assertion above,
     so it is checked from the build output instead. */
  const apiDir = path.join(ROOT, ".next", "server", "app", "api");
  if (existsSync(apiDir)) {
    const frozen = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry.endsWith(".body")) frozen.push(path.relative(apiDir, full));
      }
    };
    walk(apiDir);
    for (const file of frozen) {
      failures.push(
        `/api/${file.replace(/\.body$/, "")}: prerendered at build time — add \`export const dynamic = "force-dynamic"\``,
      );
    }
    checks += 1;
  }

  if (server) server.child.kill();
  // Take the smoke accounts back out of the developer's database.
  if (!tempDir) await cleanupDatabase(databaseUrl);
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });

  console.log(`\n${checks} checks`);
  for (const note of skipped) console.log(`  skipped  ${note}`);

  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILED\n`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
  }

  console.log("\n✓ every route rendered for every role\n");
  process.exit(0);
}

// Only run when invoked directly — smoke-browser.mjs imports the helpers above.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
