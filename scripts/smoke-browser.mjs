#!/usr/bin/env node
/**
 * The smoke suite, run in a real browser.
 *
 * `npm run smoke` asserts that every route returns 200 with no error boundary
 * in the HTML. That catches everything that fails on the server — and nothing
 * that fails after it. A page whose server component queries cleanly but whose
 * client component reads `client.project.title` on a client with no project
 * returns a flawless 200, and only breaks once React runs. Every route in this
 * app renders its real content in a client component, so that blind spot
 * covers most of the product.
 *
 * This run loads each page in headless Chrome, waits for hydration and the
 * fetches that follow it, and fails on an error boundary or an uncaught
 * exception. It needs a Chrome-family browser on the machine and skips
 * cleanly when there isn't one, so it never becomes the reason a build fails
 * somewhere without a desktop browser.
 *
 *   npm run smoke:browser
 */
import { connect, launch, findBrowser } from "./cdp.mjs";
import {

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

  ADMIN,
  LEAD,
  MEMBER,
  Session,
  discoverRoutes,
  loadEnv,
  prepareDatabase,
  cleanupDatabase,
  startServer,
  waitForServer,
} from "./smoke.mjs";

loadEnv();

const PORT = Number(process.env.SMOKE_PORT ?? 3012);
const BASE = process.env.SMOKE_BASE ?? `http://localhost:${PORT}`;

/** Noise that says nothing about whether the page works. */
const IGNORE = /favicon|manifest\.json|Download the React DevTools|sw\.js|web-vitals/i;

/** Everything spawned, so a failure can still clean up after itself. */
const SPAWNED = [];

function cleanup() {
  for (const child of SPAWNED) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
}

const ROLES = [
  { name: "ADMIN", creds: ADMIN, role: "ADMIN" },
  { name: "SERVICE_LEAD", creds: LEAD, role: "MEMBER" },
  { name: "MEMBER", creds: MEMBER, role: "MEMBER" },
];

async function main() {
  if (!findBrowser()) {
    console.log("No Chrome-family browser found — skipping the browser smoke run.");
    process.exit(0);
  }

  const ids = await prepareDatabase(process.env.DATABASE_URL);

  console.log(`Starting a server on :${PORT}…`);
  const server = startServer({ DATABASE_URL: process.env.DATABASE_URL }, PORT);
  SPAWNED.push(server.child);
  try {
    await waitForServer(120_000, BASE);
  } catch (error) {
    console.error(server.log.join("").slice(-3000));
    throw error;
  }

  const routes = discoverRoutes()
    .sort()
    .filter((route) => route !== "/login" && route !== "/");

  const urlFor = (route) => {
    if (!route.includes("[")) return route;
    const id = ids[route];
    return id ? route.replace(/\[[^\]]+\]/, id) : null;
  };

  /* Warm every route over HTTP first. In dev the first request to a route
     compiles it, which can take longer than any sensible per-navigation
     timeout — and a compile stall in the browser looks identical to a hung
     page. Warming moves that cost somewhere it cannot be mistaken for a
     failure. */
  console.log("Warming routes (first request compiles them)…");
  const warm = new Session("warm", BASE);
  await warm.signIn(ADMIN.email, ADMIN.password);
  for (const route of routes) {
    const url = urlFor(route);
    if (url) await warm.fetch(url);
  }

  const browser = await launch(9335);
  SPAWNED.push(browser.child);
  const conn = await connect(browser.webSocketDebuggerUrl);

  const failures = [];
  let checks = 0;

  console.log(`\n${routes.length} routes × ${ROLES.length} roles — in a real browser\n`);

  for (const role of ROLES) {
    /* A fresh page per role. Reusing one tab let state from the previous
       role's last page — a pending fetch, a registered service worker —
       outlive the cookie swap, and the next navigation would hang on it. */
    const { targetId } = await conn.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await conn.send("Target.attachToTarget", { targetId, flatten: true });
    for (const domain of ["Page", "Runtime", "Log", "Network"]) {
      await conn.send(`${domain}.enable`, {}, sessionId);
    }

    let bucket = [];
    conn.on((msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.exceptionThrown") {
        const details = msg.params.exceptionDetails;
        bucket.push(details.exception?.description ?? details.text ?? "uncaught exception");
      }
      if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
        bucket.push(`${msg.params.entry.text} ${msg.params.entry.url ?? ""}`);
      }
    });

    // Sign in over HTTP, then hand the cookies to the browser: driving a login
    // form adds a step that can fail for reasons unrelated to what is measured.
    const session = new Session(role.name, BASE);
    await session.signIn(role.creds.email, role.creds.password);
    await conn.send("Network.clearBrowserCookies", {}, sessionId);
    for (const [name, value] of session.jar) {
      await conn.send(
        "Network.setCookie",
        { name, value, domain: "localhost", path: "/" },
        sessionId,
      );
    }

    for (const route of routes) {
      // A member is correctly refused another member's report; the HTTP suite
      // asserts that refusal, so there is no page to render here.
      if (route === "/reports/[id]" && !isAdminRole(role.role)) continue;
      const url = urlFor(route);
      if (!url) continue;

      bucket = [];
      try {
        await conn.send("Page.navigate", { url: BASE + url }, sessionId);
      } catch (error) {
        failures.push(`${role.name} ${url}: navigation never completed (${error.message})`);
        continue;
      }
      // Enough for hydration and the fetches a page fires on mount.
      await new Promise((resolve) => setTimeout(resolve, 2_500));
      checks += 1;

      let text = "";
      try {
        const result = await conn.send(
          "Runtime.evaluate",
          {
            expression: "document.body ? document.body.innerText.slice(0, 4000) : ''",
            returnByValue: true,
          },
          sessionId,
        );
        text = result.result?.value ?? "";
      } catch {
        // An evaluate can race a navigation; the console bucket still counts.
      }

      if (text.includes("This page didn't load") || text.includes("This page didn’t load")) {
        failures.push(`${role.name} ${url}: rendered the error boundary`);
        continue;
      }

      const errors = bucket.filter((entry) => !IGNORE.test(entry));
      if (errors.length > 0) {
        failures.push(`${role.name} ${url}: ${errors[0].split("\n")[0]}`);
      }
    }

    await conn.send("Target.closeTarget", { targetId });
    console.log(`  ${role.name.padEnd(13)} done`);
  }

  conn.close();
  cleanup();
  await cleanupDatabase(process.env.DATABASE_URL);

  console.log(`\n${checks} pages loaded`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILED\n`);
    for (const failure of failures) console.log(`  ✗ ${failure}`);
    process.exit(1);
  }
  console.log("\n✓ every route hydrated cleanly for every role\n");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  // Whatever went wrong, do not leave a dev server holding the port — the next
  // run would fail with EADDRINUSE and blame itself.
  cleanup();
  process.exit(1);
});
