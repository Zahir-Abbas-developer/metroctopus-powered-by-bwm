/**
 * Give every account a different, freshly generated password.
 *
 *   DATABASE_URL="postgresql://…"  npm run set-passwords              # dry run: lists accounts
 *   DATABASE_URL="postgresql://…"  npm run set-passwords -- --yes      # sets the passwords
 *   DATABASE_URL="postgresql://…"  npm run set-passwords -- --yes --only a@bwm.local,b@bwm.local
 *
 * PowerShell sets the variable differently: `$env:DATABASE_URL="postgresql://…"`
 * on its own line first, then `npm.cmd run set-passwords -- --yes`.
 *
 * ## Why it exists
 *
 * Every seeded account started on one shared placeholder, and that placeholder
 * is written in a public repository. Once people have started changing theirs,
 * nobody can say any more which accounts still use it — passwords are stored as
 * bcrypt hashes, so they cannot be read back, only replaced. This replaces them:
 * one strong, different password per active account, printed once, stored
 * nowhere, with `mustChangePassword` set so each person swaps it for their own
 * at first sign-in.
 *
 * ## Why it is two processes
 *
 * Prisma's client is generated for one database engine. This repository
 * develops on SQLite and runs on Postgres, so pointing the local client at the
 * live database means regenerating it for Postgres first — and regenerating it
 * back afterwards, or the next `npm run dev` fails against dev.db with an error
 * that has nothing to do with passwords. The outer process does that switch,
 * and puts it back in a `finally`, so a failure mid-way still leaves local
 * development working. The inner process (`--worker`) is started fresh after
 * generation so it loads the client that was just built rather than the one
 * already in memory.
 *
 * It writes nothing to disk except the regenerated client, and it never runs
 * without `--yes`.
 */

import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

/* ---------------------------------------------------------------- outer -- */

function orchestrate() {
  const target = process.env.DATABASE_URL;
  const local = localDatabaseUrl();

  if (!target || !/^(postgres(ql)?:\/\/|file:)/.test(target)) {
    fail(
      "Set DATABASE_URL to the database whose passwords you want to change.\n" +
        "  For the live site: Vercel -> agency-os -> Settings -> Environment Variables\n" +
        "  -> DATABASE_URL, or Neon -> your project -> Connect.",
    );
  }

  console.log(`\n  Database: ${describe(target)}${target === local ? "  (your LOCAL database)" : ""}\n`);

  const passThrough = args.filter((arg) => arg !== "--worker").join(" ");

  try {
    run("node scripts/sync-db-provider.mjs", target);
    run("npx prisma generate", target, { quiet: true });
    run(`node scripts/set-passwords.mjs --worker ${passThrough}`, target, { inherit: true });
  } finally {
    // Put the local client back, whatever happened above.
    if (local && local !== target) {
      console.log("\n  Restoring the local Prisma client…");
      run("node scripts/sync-db-provider.mjs", local, { quiet: true, allowFailure: true });
      run("npx prisma generate", local, { quiet: true, allowFailure: true });
    }
  }
}

function run(command, databaseUrl, { quiet = false, inherit = false, allowFailure = false } = {}) {
  const result = spawnSync(command, {
    cwd: ROOT,
    shell: true,
    stdio: inherit ? "inherit" : quiet ? "pipe" : "inherit",
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  if (result.status !== 0 && !allowFailure) {
    if (quiet) process.stderr.write(result.stderr ?? "");
    // Throw rather than exit so the `finally` above still restores the client.
    throw new Error(`"${command}" failed`);
  }
}

/** The DATABASE_URL in .env — what local development points at. */
function localDatabaseUrl() {
  const file = join(ROOT, ".env");
  if (!existsSync(file)) return null;
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((row) => /^\s*DATABASE_URL\s*=/.test(row));
  return line ? line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "") : null;
}

/** Host and database name only — never the password in the URL. */
function describe(url) {
  if (url.startsWith("file:")) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(unparseable URL)";
  }
}

function fail(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/* ---------------------------------------------------------------- inner -- */

/**
 * Letters and digits that cannot be mistaken for each other when read aloud or
 * copied off a phone screen: no 0/O, 1/l/I.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * Three groups of four, e.g. `k7Qm-3xTp-9wZr`.
 *
 * About 69 bits from a 54-character alphabet — far past guessing through a
 * login form limited to eight attempts per account per ten minutes, and still
 * short enough to type once before it is replaced. Regenerated until it holds
 * an upper case letter, a lower case letter and a digit, so no password-rule
 * anywhere downstream can reject it.
 */
function generatePassword() {
  for (;;) {
    const groups = Array.from({ length: 3 }, () =>
      Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
    );
    const password = groups.join("-");
    if (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password)) {
      return password;
    }
  }
}

async function worker() {
  const apply = args.includes("--yes");
  const onlyArg = args.find((arg) => arg.startsWith("--only"));
  const onlyIndex = args.indexOf("--only");
  const onlyValue = onlyArg?.includes("=")
    ? onlyArg.split("=")[1]
    : onlyIndex >= 0
      ? args[onlyIndex + 1]
      : null;
  const only = onlyValue
    ? onlyValue.split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)
    : null;

  const { PrismaClient } = await import("@prisma/client");
  const bcrypt = (await import("bcryptjs")).default;
  const prisma = new PrismaClient();

  try {
    const users = await prisma.user.findMany({
      where: { isActive: true, ...(only ? { email: { in: only } } : {}) },
      orderBy: [{ role: "asc" }, { name: "asc" }],
      select: { id: true, name: true, email: true, role: true },
    });

    if (only) {
      const found = new Set(users.map((user) => user.email));
      const missing = only.filter((email) => !found.has(email));
      if (missing.length > 0) {
        console.log(`  Not found or deactivated: ${missing.join(", ")}\n`);
      }
    }

    if (users.length === 0) {
      console.log("  No active accounts matched. Nothing to do.\n");
      return;
    }

    if (!apply) {
      console.log(`  ${users.length} active account(s) would get a new password:\n`);
      for (const user of users) {
        console.log(`    ${user.email.padEnd(28)} ${user.name.padEnd(16)} ${user.role}`);
      }
      console.log("\n  Dry run — nothing changed. Add --yes to set the passwords.\n");
      return;
    }

    const issued = [];
    for (const user of users) {
      const password = generatePassword();
      await prisma.user.update({
        where: { id: user.id },
        data: {
          // Cost 10, the same as every other account-creation path in the app.
          passwordHash: await bcrypt.hash(password, 10),
          // Theirs to replace: a password somebody else generated and sent
          // through a chat is not a password that should last.
          mustChangePassword: true,
        },
      });
      issued.push({ ...user, password });
    }

    console.log(`  New passwords set for ${issued.length} account(s):\n`);
    console.log(`    ${"Email".padEnd(28)} ${"Name".padEnd(16)} ${"Role".padEnd(14)} Password`);
    console.log(`    ${"-".repeat(28)} ${"-".repeat(16)} ${"-".repeat(14)} ${"-".repeat(14)}`);
    for (const row of issued) {
      console.log(
        `    ${row.email.padEnd(28)} ${row.name.padEnd(16)} ${row.role.padEnd(14)} ${row.password}`,
      );
    }
    console.log(
      "\n  Shown once and stored nowhere — copy them now. Send each person only their\n" +
        "  own, privately. Everyone is asked to choose their own at first sign-in.\n",
    );
  } finally {
    await prisma.$disconnect();
  }
}

/* ------------------------------------------------------------ dispatch -- */

// Last, not first. The dispatch runs the moment the module is evaluated, so at
// the top of the file it reached generatePassword() while ALPHABET below it
// was still in its temporal dead zone — a crash that only `--yes` could hit,
// since a dry run never generates a password.
if (args.includes("--worker")) {
  await worker();
} else {
  orchestrate();
}
