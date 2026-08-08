# Progress

A running log of completed work. Newest entries at the bottom.

---

## Phase 1 — Foundation (8 August 2026)

The scaffold, design system, authentication and team management. No client,
project or scoring features yet — those are Phases 2–6.

### Scaffold

Next.js 14.2 (App Router) + TypeScript (strict), Tailwind CSS 3.4, Prisma 5.22
on SQLite, NextAuth 4.24 credentials. Hand-scaffolded rather than via
`create-next-app`, which refuses to initialise into a directory that already
contains files.

### Design system

`tailwind.config.ts` carries the palette from CLAUDE.md as named tokens — `ink`,
`paper`, `cream`, `line`, `brand`, `warn`, `danger`, `info`, each with its tint.
No hue outside that list exists in the codebase: secondary text uses opacity
modifiers on `ink` (`text-ink/60`) rather than invented greys.

Syne (600–800) and DM Sans (400–600) load through `next/font/google` as CSS
variables mapped to `font-display` and `font-sans`. Signature treatments live in
`app/globals.css` as `.eyebrow`, `.surface-dark` (the radial green glow) and
`.hairline`.

Components in `/components/ui`:

| Component | Notes |
| --- | --- |
| `Button` | primary / secondary / ghost / danger / dark, 3 sizes, loading spinner |
| `Card` | + `CardHeader`, `CardBody`; paper / cream / dark surfaces |
| `Badge` | success / warning / danger / info / neutral pills, optional status dot |
| `Input` | label, hint, error, icon, wired-up `aria-describedby` |
| `Select` | native select with chevron, shares Input's field styling |
| `Modal` | portal, escape to close, scroll lock, focus-in, sticky footer |
| `Table` | `TableShell` / `Table` / `THead` / `TBody` / `TR` / `TH` / `TD` |
| `EmptyState` | + `ErrorState` with retry — no screen is ever left blank |
| `PageHeader` | eyebrow + Syne title, light or dark-hero variant |
| `StatCard` | oversized Syne figure, unit, hint, shimmer loading state |
| `Avatar`, `Skeleton` | initials chip; shimmer placeholder |

### Database

`User` only: `id` (cuid), `name`, `email` (unique), `passwordHash`, `role`,
`jobTitle`, `avatarColor`, `isActive`, `createdAt`, `updatedAt`.

`prisma/schema.prisma` also carries commented-out models for `Client`,
`ClientService`, `Project`, `Module`, `Milestone`, `Task`, `ScoreEvent` and
`Report`, so later phases slot in without reshaping what's already there.

Postgres-compatibility is maintained deliberately: cuid IDs (no autoincrement),
no Json or array columns, and enums modelled as `String` + a union in
`lib/constants.ts` because SQLite has no native enum type. Deploying to Neon or
Supabase should need only the `provider` line changed.

### Authentication

Credentials provider with bcrypt. The session JWT carries `id`, `role`,
`jobTitle` and `avatarColor`, so the shell renders identity without a database
round trip. Deactivated accounts are refused at sign-in.

Two guard layers:

- `middleware.ts` — no token redirects to `/login`; a MEMBER token hitting an
  admin route is bounced to `/dashboard?denied=admin`.
- `lib/session.ts` — `requireUser()` / `requireAdmin()` re-check on the server
  in every page, so a mis-typed matcher can't expose a screen.

The API checks the role again in `lib/api.ts`. Hiding a button is not access
control.

Seed (`npm run db:seed`) creates 1 admin and 6 members across the agency's
service lines and prints the credentials. It upserts, so it's safe to re-run.

```
admin@agency.local     admin123     ADMIN  · Agency Owner
ayesha@agency.local    member123    MEMBER · Shopify Developer
bilal@agency.local     member123    MEMBER · Google Ads Specialist
hira@agency.local      member123    MEMBER · Meta Ads Specialist
usman@agency.local     member123    MEMBER · Creative Designer
fatima@agency.local    member123    MEMBER · Creative Strategist
daniyal@agency.local   member123    MEMBER · Funnel Manager
```

### Screens

- **`/login`** — split screen. Left is near-black with the radial green glow,
  the wordmark in Syne 800 and the service list; right is the form on warm
  white. Failures are deliberately vague ("those credentials didn't work") so
  the form can't be used to enumerate staff.
- **App shell** — fixed 240px dark rail with the wordmark, role-filtered nav,
  identity block and sign-out. Below `lg` it becomes a slide-over drawer behind
  a top bar. Content sits on `#FAFAF7` in a 1180px container.
- **`/dashboard`** — dark hero with a timezone-correct greeting, four StatCards
  (Active Clients, Open Tasks, On-Time Rate, Avg Team Score — all zero until
  later phases), and two designed empty states.
- **`/team`** (admin) — member table with avatar, job title, role, status and
  joined date, plus add / edit / deactivate modal forms.
- **`/clients`, `/projects`, `/tasks`, `/reports`** — designed holding screens
  naming the phase each belongs to, so nav links never 404.

### Team management API

`GET`/`POST /api/team`, `PATCH /api/team/[id]`. Zod schemas in `lib/validation.ts`
are shared by the forms and the handlers. Members are deactivated, never
deleted, so past work stays attributable. Guards prevent the owner from
deactivating or demoting themselves, or the agency from losing its last active
owner. The password hash is never in a response body.

### Conventions established

- All dates go through `lib/date.ts` (Asia/Karachi). No component formats a
  date inline.
- `lib/routes.ts` is the single nav + permission map, shared by the middleware
  and the sidebar so they can't drift.
- Every data fetch has a loading state, an error state with retry, and an empty
  state.

### Verification

- `tsc --noEmit` clean, `next lint` clean, production build clean (12 routes).
- 38 automated HTTP checks against the production server, all passing:
  anonymous redirects, both roles' sessions, admin route and API guards,
  rejected credentials, full team CRUD, validation codes, duplicate-email
  conflict, deactivated-user sign-in refusal, and the owner-lockout guards.
- Login, dashboard, team, modal, mobile and member views checked visually.

### Two bugs found and fixed during verification

1. `withAuth` doesn't inherit `pages` from `authOptions`, so anonymous traffic
   landed on NextAuth's default `/api/auth/signin` instead of the designed
   login screen. The middleware now declares `pages.signIn` itself — it can't
   import `authOptions`, which pulls in Prisma and bcrypt and won't run on the
   edge.
2. Near-black was in the avatar palette, making a chip invisible against the
   dark sidebar. Removed, leaving the four accent tokens. The colour hash was
   then rewritten to FNV-1a with an avalanche fold: the old `hash * 31` sum put
   almost no entropy in the low bits, and since every address shares the
   `@agency.local` suffix, five of seven members had collapsed onto one colour.

### Next up (Phase 2)

Client onboarding with per-client service selection, and the `Client` /
`ClientService` models.

---

## Phase 2 — Clients and engagement structure (8 August 2026)

Client onboarding, the monthly engagement cycle, and the plan it generates.
Built together with Phase 3 in one pass, so the database migrated once.

### Data model

| Model | Purpose |
| --- | --- |
| `Client` | businessName, contactName, email, phone, country, industry, monthlyBudget, status, notes, onboardedAt |
| `ServiceCatalog` | the five offerings, seeded and owner-editable |
| `Project` | one engagement cycle: title, startDate, endDate, status, closedOutAt |
| `ProjectService` | which services a cycle covers (join model, not an array column) |
| `Module` | a workstream inside a cycle, ordered |
| `Milestone` | title, description, weight 1–5, dueDate, status, submittedAt, completedAt, assignee, order |

Two decisions worth recording:

- **Services live on the project, not the client.** A retainer's scope changes
  month to month, and the brief puts service selection on `Project`. A client's
  service badges are derived from its most recent cycle, so there is one source
  of truth rather than two that can disagree.
- **`monthlyBudget` is an integer** of whole currency units. Money is never a
  `Float`.

### Date handling

Date-only fields (`startDate`, `endDate`, `dueDate`) are stored at UTC midnight
of the intended calendar day, which formats back to the same day in Karachi.

A due date means "by the end of that day, in the office's timezone", so
`dueDeadline()` resolves it to 19:00 UTC — midnight in Karachi. Every overdue
check and every scoring decision uses that instant, never the raw stored date.
Without it, anything due today would count as late from 05:00 local onwards.

### Templates

Picking a service expands into the workstream it actually involves, dated
relative to the project start:

| Service | Module | Milestones |
| --- | --- | --- |
| Shopify Design & Development | Shopify Store | audit → design → build → QA → launch |
| Google Ads Management | Google Ads | tracking setup → launch → weeks 2, 3, 4 |
| Meta Ads Management | Meta Ads | pixel/CAPI → launch → weeks 2, 3, 4 |
| Creative Research & Design | Creative | research → concepts → 3 delivery batches |
| Full Funnel | Full Funnel | audit → landing pages → CRO → attribution |

Every project also gets a **Weekly Reporting** module: four client reports,
seven days apart. Delivery work is pre-assigned by specialism
(`SERVICE_JOB_TITLES`); the weekly reports are deliberately left unassigned,
because the brief is explicit that the owner decides who fronts the client.

A two-service engagement therefore arrives as 3 modules and 14 milestones, all
editable.

### Screens

- **`/clients`** — card grid with business name, industry, status pill, budget,
  service badges and the current cycle's progress bar. Status filters and
  search run client-side; the whole book is a few dozen rows, so a round trip
  per keystroke would be slower than the filter.
- **Onboarding wizard** — three steps (business → services → engagement).
  Step 2 shows what each service will generate before it's picked; step 3
  previews the exact module and milestone counts. On finish it lands on the new
  project's plan.
- **`/clients/[id]`** — dark identity header, then Overview | Projects | Notes.
- **`/projects/[id]`** — the planner. Dark editorial header with the client,
  date range, days-remaining counter and completion bar; then modules as
  sections. Each milestone row carries weight as dots, an inline assignee
  picker, a due date that turns amber inside 48 hours and red once overdue, its
  status pill, and the points it has cost. Add, edit, delete, reorder and
  reassign all happen inline.
- **`/projects`** — every cycle across the agency, with overdue counts.
- **`/my-tasks`** — a member's own milestones grouped Overdue / Due this week /
  Upcoming / Settled, with Start and Submit actions.

### Guards

One live cycle per client at a time: overlapping engagements would make "the
current project" on every card ambiguous, so the API rejects them with a 409.

Members reach their work through `/my-tasks`; `/projects/*` is owner-only.
Because middleware blocks that prefix outright, the member task list renders
project titles as plain text rather than links that would bounce them to an
access-denied screen.

---

## Phase 3 — The performance scoring engine (8 August 2026)

The differentiator. Implemented as specified, with the rules isolated in one
pure module so they can be tested exhaustively.

### The rules (`lib/scoring.ts`)

Every member starts each calendar month at **100 points**.

| Event | Charge |
| --- | --- |
| `LATE` | `weight × 1`, plus `0.5 × weight` per additional full 24h, capped at `weight × 3` |
| `MISSED` | `weight × 4` |
| `REJECTED` | `weight × 0.5`, charged again on every rejection |
| `EARLY_BONUS` | `+1` when delivered 24h or more before the deadline |
| `MANUAL_ADJUST` | whatever the owner enters, with a mandatory written reason |

Monthly score = `100 + sum(that month's events)`, clamped to 0–100.

The module is pure: no Prisma, no clock, no timezone lookups. Every function
takes its inputs explicitly, which is what makes the test suite possible.

Points are always multiples of 0.5 — exactly representable in binary floating
point, so summing a long ledger never drifts the way tenths would.

### The ledger

`ScoreEvent` is append-only: `userId`, `milestoneId`, `type`, signed `points`,
`reason`, `year`, `month`, `dedupeKey`, `createdById`. **There is no mutable
score column anywhere in the schema** — the displayed score is always a
projection of the events.

Idempotency is a database guarantee, not a convention. Automatic events carry a
unique `dedupeKey` (`"<milestoneId>:LATE"`); the repeatable ones (rejections,
manual adjustments) carry null, and both SQLite and Postgres permit multiple
NULLs in a unique index. Re-running the evaluation collides on that index and
writes nothing.

### Status flow

`PENDING → IN_PROGRESS → SUBMITTED` belongs to the member.
`SUBMITTED → COMPLETED` (approve) and `SUBMITTED → IN_PROGRESS` (reject, reason
required) belong to the owner alone. `completedAt` is stamped at approval, and
scoring reads that timestamp — never the member's own claim. Letting members
self-approve would make the entire measure self-reported.

Reverting an approval clears `completedAt` but leaves the ledger entry it
produced. History is append-only; a manual adjustment is the way to compensate.

### The evaluation pass

`/api/cron/evaluate`, wired to a **Run evaluation** button on the owner's
dashboard and ready for Vercel Cron (a `CRON_SECRET` bearer token is accepted
without a session, which is why `/api/cron/*` is outside the middleware
matcher). It reports overdue work, catches up any LATE/EARLY_BONUS charge the
approval handler missed, and closes out ended cycles — marking unfinished
milestones MISSED, charging them, and settling the project's own status.

**One interpretation to flag.** The brief lists "marks overdue milestones" as a
job step. A milestone past due inside a *running* project is deliberately not
forced to MISSED: the member can still deliver it late for a smaller charge,
and forcing the status would break their flow while storing a fact the due date
already implies. Overdue is derived for display; MISSED is a real, charged
state that happens at close-out. The pass reports the overdue count so a run is
still auditable. Say the word if you want overdue stored instead.

### Screens

- **`/team/[id]`** (owner) and **`/my-performance`** (member) share one
  component — same numbers on both sides, so nothing is hidden from the person
  being measured. Large score ring in the band colour, trend against last
  month, on-time rate, points lost and earned, and the full event timeline with
  a signed points chip, the reason, and who applied it. Manual adjustments are
  visually distinct.
- **`/team`** — sortable Score column with mini rings and month-on-month deltas.
- **Dashboard** — real numbers now: active clients, open milestones, on-time
  rate, average team score. Plus a **Team performance** leaderboard and an
  **At risk** card listing everything due within 48 hours or already late, with
  weights and assignees.

Score bands: 90–100 Excellent (green), 75–89 Good (blue), 60–74 Needs attention
(amber), below 60 Critical (red) — all four from the fixed palette.

### Verification

- **39 unit tests** on `lib/scoring.ts` (`npm test`), covering on time, one
  minute late, one day late, three days late, the `weight × 3` cap at four days
  and beyond, missed, repeat rejections, the early bonus and its 24h boundary,
  clamping at both 0 and 100, half-point precision across a 40-event ledger,
  every band boundary, and idempotent re-evaluation for both completions and
  misses.
- **90 HTTP checks** against the production build — 52 new plus the 38 from
  Phase 1, all passing. The new ones cover onboarding, template generation
  (3 modules / 14 milestones / 4 weekly reports / 10 auto-assigned), overlap
  rejection, the member's own-work-only scope, every permission boundary,
  rejection and approval scoring, manual-adjustment validation, running the
  evaluation three times with zero new events, and `score == 100 + sum(events)`
  verified straight against the database.
- `tsc`, `next lint` and the production build are clean (23 routes).

### Bugs found and fixed while verifying

1. `tsconfig.json` had no `target`, so `tsc` defaulted to ES5 and rejected every
   `Map`/array iteration. Set to ES2022. (A stale `.tsbuildinfo` then masked the
   fix — worth remembering.)
2. A member clicking their project name in **My tasks** was bounced to
   `/dashboard?denied=admin`, because `/projects/*` is owner-only. Members now
   see the title as plain text.
3. A member with no approvals yet this month showed a red **0% on time**, which
   reads as failure rather than "no data". Now shows an em dash. The dashboard's
   agency-wide rate is all-time and now says so, since it sits beside
   cycle-scoped per-member rates.
4. "0 days overdue" for anything late by less than a day now reads "overdue
   today".
5. The At-risk card silently truncated at 8 rows. It now counts everything at
   risk in the badge and says when it is showing a subset.

### Next up (Phase 4)

Weekly and monthly report generation for the owner and each member, built on
the ledger this phase produced.
