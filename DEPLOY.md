# Deploying to Vercel

Verified before writing this: `npx tsc --noEmit` clean, `npm run lint` clean,
`npm run build` passes, 461 tests pass, and every route renders dynamically.

## What you must supply

Neither of these can be automated — both need a browser and an account.

1. **A Vercel account.** `vercel login` opens one.
2. **A Postgres connection string.** Neon, Supabase or Vercel Postgres. Free
   tiers are ample for a six-person team. It must start with `postgresql://`.
   Prefer the **pooled** string for serverless; if your provider also gives an
   unpooled one, set it as `DATABASE_URL_UNPOOLED` — the build uses it for the
   schema push, which pgbouncer cannot do.

## Steps

### 1. Provision Postgres

Create the database and copy the connection string. Nothing else to configure.

### 2. Import the repository

This project has a GitHub remote, so the simplest route is Vercel's git
integration rather than the CLI: **Vercel → Add New → Project → Import** from
`Zahir-Abbas-developer/metroctopus-powered-by-bwm`. Every push to `main` then
deploys on its own.

The CLI works too, if you would rather deploy from your machine:

```bash
npm i -g vercel
vercel login
vercel link
```

### 3. Set environment variables

Vercel → Project → Settings → Environment Variables, **Production** scope. Four
are required; the fifth is strongly recommended and explained below.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Your pooled Postgres string |
| `DATABASE_URL_UNPOOLED` | The direct string, if your provider offers one |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | The deployed URL — see step 5 for what it does and does not control |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `SEED_PASSWORD` | **Read the next section before skipping this.** |

### 4. Deploy

Push to `main`, or run `vercel --prod`.

`vercel-build` does the database work itself: it flips the Prisma provider to
`postgresql`, pushes the schema, and runs `prisma/seed.ts` before building. You
do not run any database command by hand.

### 5. `NEXTAUTH_URL` — less of a trap on Vercel than it looks

An earlier version of this guide said login fails until `NEXTAUTH_URL` matches
the deployed domain. On Vercel that is not true, and it sent people through an
extra redeploy for nothing. NextAuth 4's `detectOrigin` checks
`process.env.VERCEL`, which Vercel sets on every deployment, and when it is
present builds its URLs from the host the request actually arrived on —
`NEXTAUTH_URL` is not consulted. Adding or renaming a domain therefore needs no
redeploy for sign-in to work: `/api/auth/providers` on the new domain already
reports callback URLs on that domain.

It still matters in two places. **Off Vercel** — `next start` on your own
machine, `npm run share`, any other host — `NEXTAUTH_URL` is the only source of
the origin, and a mismatch does bounce every sign-in back to `/login` with no
error. And **email links** fall back to `NEXTAUTH_URL` when `APP_URL` is unset,
so keep one of the two pointing at the address you actually share.

---

## Before you share the URL: the seeded passwords

`vercel-build` runs `prisma/seed.ts` on every deploy. In this fork that seed is
*structural* — four departments, their pipeline stages and field definitions,
and the six team accounts. It creates no fake clients and no fake leads, which
is why it runs on production here even though the upstream agency fork warned
against it.

What it does create, on the **first** deploy, is six accounts sharing one
password:

```
coachd@bwm.local  rajazain@bwm.local  tayyaba@bwm.local
claire@bwm.local  cam@bwm.local       cheryl@bwm.local
```

The default is `bwm-change-me`, and it is written in this repository. On a
public URL that is a published credential for every account on the system.
`mustChangePassword` forces a change at first sign-in, but it forces it on
whoever signs in first — which is protection only if that person is the real
one.

**Set `SEED_PASSWORD` in Vercel to something private before the first deploy.**
Send it to the team through a channel that is not this repository, and have
everyone sign in and set their own password the same day.

Redeploys leave the database alone. The seed creates what is missing and
overwrites nothing: an existing account keeps its password, name, role, job
title and skills; an existing department keeps its name, stages and fields;
and a stage, field or membership an admin deleted stays deleted. (It used to
rewrite all of that on every deploy, and put back whatever had been removed.)

It also means `SEED_PASSWORD` only matters for accounts that do not exist
yet. Setting it after the first deploy changes nobody's password.

## After it is live

- `vercel.json` defines four crons — `/api/cron/evaluate`, `/reports`,
  `/digest` and `/follow-ups`. They begin firing on their own and authenticate
  with `CRON_SECRET`. Vercel's Hobby plan allows daily schedules only; the
  current entries are within that.
- Every app and API route is gated by `middleware.ts`. The cron routes are
  deliberately excluded and check the bearer token themselves.
- Email is optional. With `SMTP_HOST` unset, messages are logged and skipped
  rather than failing the request that triggered them — so the welcome email
  that carries a new member's password is **not** sent. Until SMTP is
  configured, whoever adds a team member has to pass the password on directly.
- `prisma/dev.db` stays local and is never deployed. Local development is
  unaffected: `.env` still points at SQLite and the provider flips back on the
  next `npm run dev`.
