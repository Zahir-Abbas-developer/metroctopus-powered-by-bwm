# Deploying Agency OS to Vercel

Verified before writing this: `npm run typecheck` clean, `npm run build` passes,
all routes render dynamically. Secrets are pre-generated in `.env.vercel.local`.

## What you must supply

1. **A Vercel account** — `vercel login` opens a browser; it cannot be automated.
2. **A Postgres connection string** — Neon, Supabase, or Vercel Postgres.
   Free tiers are fine for this workload.

## Steps

### 1. Provision Postgres
Create a database and copy the connection string. It must start with
`postgresql://`. Prefer the **pooled** connection string for serverless.

### 2. Install the CLI and link the project
```bash
npm i -g vercel
cd "~/AdvertiseX OS/AdvertiseX Team OS"
vercel login
vercel link
```
There is no git remote, so this deploys directly from the local directory.

### 3. Create the production schema
Run this locally, pointed at Postgres. `sync-db-provider.mjs` rewrites
`prisma/schema.prisma` from `sqlite` to `postgresql` automatically.
```bash
DATABASE_URL="postgresql://…" npm run db:push
```

### 4. Create your admin login
```bash
DATABASE_URL="postgresql://…" npm run db:seed:admin
```
Do **not** run `npm run db:seed` — that loads the 5-user/5-client demo dataset.

### 5. Set environment variables
Copy all four from `.env.vercel.local` into
Vercel → Project → Settings → Environment Variables (Production scope).

### 6. Deploy
```bash
vercel --prod
```

### 7. Fix NEXTAUTH_URL, then redeploy
This is the trap: NextAuth builds its callback URLs from `NEXTAUTH_URL`. Until it
matches the real domain, **login will fail** — you get redirected back to
`/login` with no error. Vercel only tells you the domain after the first deploy,
so set the variable to the assigned URL and run `vercel --prod` once more.

> **Why that filename.** These values deliberately do *not* live in
> `.env.production.local`. Next.js auto-loads that name during `next start`,
> where it overrides `.env` — pointing the local production server at
> `postgresql://REPLACE_ME`. Every login then fails with a bare 401 and nothing
> in the log, because NextAuth swallows the Prisma connect error and reports it
> as a rejected credential. `.env.vercel.local` is inert locally and still
> gitignored.

## After it is live

- `vercel.json` defines three crons (`/api/cron/evaluate`, `/reports`, `/digest`).
  They start firing automatically and authenticate with `CRON_SECRET`.
- Every app and API route is gated by `middleware.ts`. The cron routes are
  deliberately excluded and check the bearer secret themselves.
- `prisma/dev.db` stays local and is not deployed. Local dev is unaffected:
  `.env` still points at SQLite, and the provider flips back on next `npm run dev`.
