#!/usr/bin/env node
/**
 * Keeps prisma/schema.prisma's datasource provider in step with DATABASE_URL.
 *
 * Prisma refuses `provider = env("...")` outright:
 *
 *   error: A datasource must not use the env() function in the provider argument.
 *
 * So the provider has to be a literal in the file. Rather than ask people to
 * remember to edit it, this derives it from the one variable that already
 * differs between environments — the connection string itself:
 *
 *   file:./dev.db                  -> sqlite
 *   postgresql://… / postgres://…  -> postgresql
 *
 * It runs before dev, build, push, migrate and seed, so the schema always
 * matches the database being pointed at. Committing the SQLite variant by
 * accident is harmless: the next build derives postgresql from the production
 * DATABASE_URL and rewrites it again.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCHEMA = path.join(ROOT, "prisma", "schema.prisma");

/** Minimal .env reader — the script runs before Next loads anything. */
function envFromFile() {
  const file = path.join(ROOT, ".env");
  if (!existsSync(file)) return {};

  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i.exec(line);
    if (!match) continue;
    values[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return values;
}

function providerFor(url) {
  if (!url) return null;
  if (url.startsWith("file:")) return "sqlite";
  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) return "postgresql";
  return null;
}

const url = process.env.DATABASE_URL || envFromFile().DATABASE_URL;
const provider = providerFor(url);

if (!provider) {
  console.error(
    "sync-db-provider: DATABASE_URL is missing or unrecognised.\n" +
      "  Expected file:./dev.db (SQLite) or postgresql://… (Postgres).",
  );
  process.exit(1);
}

const schema = readFileSync(SCHEMA, "utf8");
const current = /datasource\s+db\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s.exec(schema)?.[1];

if (current === provider) {
  console.log(`sync-db-provider: already ${provider}`);
  process.exit(0);
}

const updated = schema.replace(
  /(datasource\s+db\s*\{[^}]*?provider\s*=\s*")[^"]+(")/s,
  `$1${provider}$2`,
);

writeFileSync(SCHEMA, updated);
console.log(`sync-db-provider: ${current ?? "unknown"} -> ${provider}`);
