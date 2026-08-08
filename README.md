# Agency OS

Internal management platform for a remote 360° digital marketing agency —
clients, monthly engagements, milestones, an automatic performance score, and
the reports and collaboration around them.

Built for one owner and six team members. Everything in it exists to answer
three questions that a chat thread cannot: who is doing what, what is late, and
how is the team actually performing.

---

## What it does

| Area | |
| --- | --- |
| **Clients** | Onboarding wizard, service catalogue, per-client engagement history |
| **Engagements** | One monthly cycle per client, expanded from planning templates into modules and dated milestones |
| **Board** | Drag-and-drop kanban with per-role permissions, filters, and a detail drawer per milestone |
| **Collaboration** | Threaded comments with @mentions, file attachments, and an audit trail on every milestone |
| **Scoring** | Everyone starts each month at 100; points come off for late, missed and rejected work, and back for early delivery |
| **Reports** | Weekly and monthly member reports, plus a client weekly — frozen snapshots, printable to A4 |
| **Notifications** | In-app bell plus optional email: welcome, weekly digest, report ready, overdue alert |

---

## Requirements

- Node 18.17+ (developed on 24)
- npm
- A Postgres database for production; SQLite is fine locally

---

## Local setup

```bash
git clone <your-repo> agency-os && cd agency-os
npm install

cp .env.example .env
# Set NEXTAUTH_SECRET — openssl rand -base64 32
# Leave DATABASE_URL as file:./dev.db for SQLite

npm run db:push     # creates the SQLite database from the schema
npm run db:seed     # demo agency: 7 people, 5 clients, 55 milestones
npm run dev
```

Open <http://localhost:3000>. The seed prints its credentials; the owner is
`admin@agency.local` / `admin123`.

### Everyday commands

| Command | |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm test` | Unit tests (scoring, narratives, mentions) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:push` | Sync the schema without a migration (local only) |
| `npm run db:migrate` | Create a migration (Postgres) |
| `npm run db:deploy` | Apply migrations (production) |
| `npm run db:seed` | Demo data — **never** in production |
| `npm run db:seed:admin` | Owner account + service catalogue only |
| `npm run db:studio` | Prisma Studio |

---

## How the database provider is chosen

Prisma rejects `provider = env("DATABASE_PROVIDER")` outright:

```
error: A datasource must not use the env() function in the provider argument.
```

So the provider has to be a literal in `prisma/schema.prisma`. Rather than ask
anyone to remember to edit it, `scripts/sync-db-provider.mjs` derives it from
the connection string and rewrites the line:

| `DATABASE_URL` | provider |
| --- | --- |
| `file:./dev.db` | `sqlite` |
| `postgresql://…` | `postgresql` |

It runs automatically before `dev`, `build`, `db:push`, `db:migrate` and both
seeds, so the schema always matches the database you are pointed at.
Committing the SQLite variant by accident is harmless — the next production
build derives `postgresql` and rewrites it again.

**Migrations are Postgres-only.** The SQL in `prisma/migrations/` is generated
for Postgres, which is the deployment target. Locally, SQLite uses
`npm run db:push`, which needs no migration history.

---

## Deployment — Vercel + Neon or Supabase

### 1. Create the database

Neon or Supabase; copy the connection string. Both want `sslmode=require`, and
Supabase's pooled connection also wants `pgbouncer=true`.

### 2. Environment variables

Set these in the Vercel project (all environments):

| Variable | Notes |
| --- | --- |
| `DATABASE_URL` | The Postgres connection string |
| `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
| `NEXTAUTH_URL` | The deployed origin, exactly |
| `CRON_SECRET` | `openssl rand -hex 32` — without it the schedule does nothing |
| `SMTP_*`, `EMAIL_FROM` | Optional; email is skipped and logged when unset |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Optional; web push is skipped when unset |
| `WHATSAPP_*` | Optional; the WhatsApp channel is skipped when unset |

`.env.example` documents every one of them.

#### Web push (optional)

Availability checks are time-critical and the in-app banner only reaches
someone with a tab open, so the app can push to a phone instead. Generate a
key pair once:

```bash
npx web-push generate-vapid-keys
```

Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (a
`mailto:you@agency.com` URL). With any of them unset, `/api/push` reports
`configured: false`, members are never prompted, and every other part of the
app behaves normally.

#### WhatsApp (optional)

If the team already lives in WhatsApp, check triggers can also go out as a
template message through the Meta WhatsApp Cloud API. It fires for availability
checks only — pushing reports and assignments down a channel people read at 2am
trains them to mute it, and a muted channel reaches nobody.

| Variable | Notes |
| --- | --- |
| `WHATSAPP_TOKEN` | A permanent system-user access token |
| `WHATSAPP_PHONE_NUMBER_ID` | From the WhatsApp > API setup panel |
| `WHATSAPP_TEMPLATE_NAME` | An approved template with one body variable (the deadline time) |
| `WHATSAPP_TEMPLATE_LANG` | Defaults to `en` |

Members need a `phone` in E.164 (`+923001234567`) on their user record. With
the variables unset the call is a silent no-op — there is no degraded mode to
worry about.

### 3. Deploy and migrate

Vercel runs `npm run build`, which syncs the provider and generates the client.
Apply migrations once against production:

```bash
DATABASE_URL="<production-url>" npm run db:deploy
```

### 4. Create the owner

```bash
DATABASE_URL="<production-url>" \
ADMIN_EMAIL="you@youragency.com" \
ADMIN_PASSWORD="<16+ characters>" \
ADMIN_NAME="Your Name" \
  npm run db:seed:admin
```

This creates the owner and the five services — **not** the demo agency. It
refuses passwords under 12 characters and known defaults like `admin123`. Sign
in, then add your team from `/team`; each member gets a welcome email with
their credentials if SMTP is configured.

### 5. Scheduled jobs

`vercel.json` registers three crons. Vercel schedules in **UTC**; the agency
works in Asia/Karachi (UTC+5):

| Path | Schedule (UTC) | Karachi | |
| --- | --- | --- | --- |
| `/api/cron/evaluate` | `0 19 * * *` | 00:00 daily | Deadline notices, scoring catch-up, project close-out, overdue alert |
| `/api/cron/reports` | `30 19 * * *` | 00:30 daily | Generates whatever the calendar says is due |
| `/api/cron/digest` | `0 3 * * 1` | 08:00 Monday | Weekly digest to each member |

`evaluate` runs at midnight Karachi because a milestone's deadline is the end
of its due day in that timezone — running then catches the day's misses
immediately. `reports` runs daily and decides for itself what is due (weeklies
on Monday, monthlies on the 1st), so the calendar logic lives in code rather
than in a cron expression.

Every job is idempotent. A retry, a duplicate invocation or a manual run
produces no double-charges and no duplicate reports.

---

## Security

- **Authorization is server-side on every route.** The client never decides a
  role. Middleware gates page routes, `requireUser`/`requireAdmin` re-check in
  each server component, and every API handler checks again. Hiding a button is
  not access control.
- **Passwords** are bcrypt-hashed (cost 10 for seeded accounts, 12 for the
  production owner). No plaintext is ever stored; the welcome email is the one
  moment a generated password exists, in the request that created it.
- **Login is rate limited** — 8 attempts per 10 minutes, bucketed by both IP
  and account, with a sliding window. The counters are in-process, so each
  serverless instance keeps its own; swapping `lib/rate-limit.ts` for
  Upstash/Redis is a drop-in change if you need a global limit.
- **Every mutation validates its body with zod** before touching the database.
- **Uploads** are limited to 10 MB and an allowlist of types. SVG is refused
  deliberately — it is script-capable. Stored filenames are server-generated
  and are the only thing used to build a path, so a hostile original filename
  is just a label. Files are served through an authenticated route with
  `nosniff` and a sandbox CSP, never as static assets.
- **Failures are vague on purpose.** A wrong password, an unknown account, a
  deactivated account and a throttled attempt all return the same thing, so the
  login form cannot be used to enumerate staff.

---

## Architecture notes

- **The score is never stored.** `ScoreEvent` is an append-only ledger and a
  score is always `100 + sum(that month's events)`, clamped to 0–100. There is
  no mutable score column anywhere in the schema.
- **Reports are frozen snapshots.** The whole document is serialized at
  generation time, so reopening a milestone in October cannot rewrite what
  August's report said.
- **Idempotency is a database guarantee**, not a convention — unique dedupe
  keys on score events, reports and notifications mean re-running any job is a
  no-op.
- **All dates go through `lib/date.ts`** (Asia/Karachi). Date-only fields are
  stored at UTC midnight; a deadline is the end of that day in agency time.
- **`lib/scoring.ts`, `lib/narrative.ts` and `lib/mentions.ts` are pure** — no
  database, no clock — which is what makes them exhaustively testable.

`PROGRESS.md` records what each phase built and why, including the bugs found
while verifying them.

---

## Tests

```bash
npm test          # 75 unit tests
npm run typecheck
npm run lint
```

The unit tests cover the scoring rules, the report narratives and the mention
parser. Beyond them, each phase has an HTTP acceptance suite run against a
production build covering permissions, idempotency and the security
boundaries — 381 checks in total.

---

## License

Private and unlicensed. Internal software.
