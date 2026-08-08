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

---

## Phase 2 acceptance & launch check (8 August 2026)

Phase 2 was re-issued, so rather than rebuild it the existing implementation
was audited line by line against the brief, the one real gap was closed, and
the whole thing was launched from an empty database to prove it runs.

### The gap that was found

The brief describes `ServiceCatalog` as **admin-editable**. It was seeded and
readable, and an unused `POST /api/services` existed, but there was no UI, no
way to rename or retire a service, and — more importantly — no way to use one.
A service the owner adds has no built-in planning template, so its projects
arrived with nowhere to put the work.

Closed with:

- `PATCH /api/services/[id]` — rename, reword, retire, restore. The `slug` is
  deliberately immutable, because it keys the planning template: renaming
  "Google Ads Management" must not orphan the plan it generates. The last
  active service cannot be retired, which would otherwise leave the onboarding
  wizard with nothing to offer and no route back.
- **Services** button on `/clients` opening a catalogue manager — add, rename,
  retire and restore, with each row stating whether it carries a template.
- `POST /api/modules` and `DELETE /api/modules/[id]`, plus an **Add a
  workstream** action on the planner. Deleting is refused while a workstream
  still holds milestones, since it would cascade through them.

### Launch check

Run from a clean slate — database file deleted, `.next` removed:

| Step | Result |
| --- | --- |
| `prisma db push` onto an empty file | schema in sync |
| `npm run db:seed` | 7 users, 5 clients, 4 projects, 12 modules, 55 milestones, 27 score events |
| `npm test` | 39/39 |
| `next lint` | clean |
| `next build` | clean, 26 routes |
| `npm start` + full acceptance suite | 126/126 |

### Acceptance coverage

126 checks against the running production build, mapped to the brief:

- **Data model** — every field the brief lists on `Client`, `Project`,
  `Module` and `Milestone` asserted present, `weight` defaulting to 3, the
  many-to-many join table, and all five offerings seeded under their exact
  names.
- **Client management** — the card grid asserted on *rendered* output, not
  server HTML, since it fetches in the browser: business name, industry, status
  pill, budget, service badges, progress. Filters, search, and all three detail
  tabs.
- **Wizard** — its three steps opened and read in a real browser, then the
  request it sends: client created, first project created, `endDate` defaulting
  to start + 30 days, services linked, and the project page reachable.
- **Templates** — 3 services + reporting = 4 modules; 5/5/5/4 milestones; every
  Google Ads weight from the brief (4, 5, 3, 3, 4); Shopify starting at audit;
  Creative starting at research; the four weekly reports exactly 7 days apart
  and left unassigned; 15 delivery milestones auto-assigned.
- **Planner** — header, days-remaining, completion, assignee chips, status
  pills, and weight rendered as dots verified through the DOM. Add, edit,
  reassign, reorder and delete all exercised, and a member refused.
- **Catalogue** — add, rename (slug unchanged), retire, hidden from the wizard
  while retired, restore, and a member refused.
- **Member view** — groups compared against what the data implies, own-work-only
  scope verified against the database, the full PENDING → IN_PROGRESS →
  SUBMITTED flow, COMPLETED refused for a member and accepted for the owner.
- **Dashboard** — each tile's figure read out of the rendered page and compared
  against a live count from the database.

### On the test harness

Six rounds of "failures" in this pass were the harness, not the app — worth
recording so the next suite avoids them:

1. JSON bodies written inline inside `"$( ... )"` have their `\"` escapes
   mangled and arrive truncated. Every body now goes through a variable.
2. `UID` is readonly in bash; assigning to it silently leaves the shell's own
   uid in place.
3. `innerText` concatenates a heading with its count, so "Overdue2" defeats
   `grep -w`.
4. `innerText` never contains an input's placeholder — that needs a DOM
   attribute read.
5. Pages that fetch client-side have none of their data in server HTML, so
   `curl | grep` proves nothing about what the user sees.
6. Asserting that all three task groups always render was simply wrong: empty
   groups are hidden by design. The check now derives the expected set from the
   data.

Only one behaviour changed as a result of this pass — the catalogue gap above.
Everything else the brief asks for was already in place and is now proven.

---

## Phase 4 — Automated reporting and notifications (8 August 2026)

Reports built on the Phase 3 ledger, and the in-app notifications that tell
people something happened.

### Reports are frozen snapshots

`Report` stores `type`, `periodStart`, `periodEnd`, `userId?`, `clientId?`,
`generatedAt` and a **`payload`** — the whole document, serialized at
generation time.

This is the central decision of the phase. A report is a statement about a
period that has closed, so reopening a milestone in October must not rewrite
what August's report said. The document pages render from the payload and never
re-query the live tables. The acceptance suite proves it: it applies a −5 point
manual adjustment after generation and asserts the existing report is
byte-identical afterwards.

The payload is `String`, not a `Json` column — SQLite has no native Json type,
and portability is the standing rule. `parsePayload()` owns the boundary, and
the payload carries a `version` so the shape can change without breaking old
documents.

Generation is idempotent through a unique `dedupeKey`
(`"<type>:<periodStart>:<subjectId>"`), the same mechanism as `ScoreEvent`.
Running it three times produced no second report. `regenerate: true` is the
deliberate escape hatch for a period whose data was corrected after the fact,
and the UI states plainly what it does.

### Narratives

`lib/narrative.ts` is pure and template-based — no model, no clock, no
database. It only ever restates numbers it was handed, which is what keeps the
prose honest and what makes 19 unit tests possible.

Two voices are written and frozen into every member report:

> **Member:** You completed 9 of 10 milestones on time this month. Your score of
> 92 places you in the Excellent band, up 4 points from last month. Watch out: 1
> late delivery in Google Ads reporting.
>
> **Owner:** Ayesha completed 9 of 10 milestones on time this month. Ayesha's
> score of 92 sits in the Excellent band, up 4 points from last month. …

Third person deliberately avoids naming the subject twice in one sentence, and
no pronoun is ever guessed. The tests pin the exact sentence from the brief,
cover every score direction, both period lengths, zero-completion periods,
single-milestone periods, multi-warning lists, and assert the output is always
two or three sentences.

### Cadence

`/api/cron/evaluate` now also generates: weekly reports on Mondays, monthly on
the 1st, both in agency time. The owner can generate any period by hand from
**Reports → Generate reports**. The same handler does both, so the manual path
and the scheduled path cannot drift.

### Client weekly

Per client per week: what completed (grouped by workstream), overall project
completion, what's planned next week, and anything overdue with how late it is.
Same editorial treatment. Internal for now, but written as if the client will
read it — which is what a portal would later reuse unchanged.

### Print

A print stylesheet in `globals.css` turns any report into a clean A4 document:
`@page size: A4`, app chrome hidden, `print-color-adjust: exact` so the dark
masthead survives, and `break-inside: avoid` on every section and row so a
report never splits a row across pages.

Verified by emulating print media and reading computed styles — the sidebar
computes to `display: none`, the print button too, the masthead keeps
`print-color-adjust: exact` — and by driving Chrome's own PDF printer, which
produced a clean 2-page A4 document.

### Notifications

`Notification` with `type`, `title`, `body`, `href`, `readAt` and an optional
`dedupeKey`. A bell sits in the top bar (added for desktop; the mobile bar
already existed), showing an unread count, with per-item and mark-all-read.

Six events raise one: work assigned to you, due tomorrow, overdue, approved,
rejected (carrying the reason), and a new report. Deadline notices are keyed
per milestone per day, so an hourly schedule warns once rather than nagging —
three consecutive evaluation runs produced no duplicates.

Emitters never throw into their caller: a notification failing to write must
not roll back the approval that triggered it.

### Routing

`/reports` is the owner's index, but `/reports/[id]` must open for a member
whose report it is. The nav map gained a `scope: "exact"` flag so the
restriction covers the index without locking the subtree — the page itself then
checks ownership, and a member requesting someone else's report gets a 404.

### Verification

- **58 unit tests** (39 scoring, 19 narrative), all passing.
- **87 Phase 4 acceptance checks** against the production build: the model, all
  nine required payload fields, idempotent generation, the frozen-snapshot
  proof, every access-control boundary, both documents rendering, the print
  behaviour under emulated print media, notification CRUD, and each of the six
  events actually firing.
- **216 earlier checks** re-run with no regressions (19 + 19 + 52 + 126).
- `tsc`, `next lint` and the production build clean, now 30 routes.

### Two things fixed while building

1. The pluraliser wrote "2 late deliverys". Consonant + y takes -ies; the fix
   covers every noun the module uses.
2. The owner's narrative read "Ayesha's score of 100 places Ayesha in the
   Excellent band" — the name three times in two sentences. Reworded, with a
   test that fails if the subject is ever named twice in one sentence.

### Next up

Email delivery for the notifications that already exist, and a client-facing
portal reusing the client weekly document.

---

## Phase 5 — Daily collaboration (8 August 2026)

The board people actually work on, and the record that replaces the chat
thread.

### Kanban board

`/board` with `@dnd-kit`: Pending, In progress, Submitted, Completed. Cards
carry the client as an eyebrow, the title, weight as dots, a due-date chip that
turns amber inside 48 hours and red once overdue, and the assignee's avatar.
Filters by project, member and service; a member sees only their own work,
scoped **in the query** rather than filtered in the browser.

Dragging enforces exactly the Phase 3 rules. The check runs twice on purpose:
`canTransition` gates the drop before the card moves — so an illegal drag is
refused with a toast instead of snapping back — and the API refuses it again.
A column that would reject the drop dims while you drag, and the move is
optimistic with a rollback if the request fails.

The drag handle is a separate target from the card body. Making the whole card
draggable makes it fiddly to open one.

### Milestone drawer

Right-hand panel with four tabs, the screen that is meant to replace the
scattered chat thread — the work, the conversation, the files and the history
all attached to the deliverable rather than to a channel.

**Comments** thread one level deep. A reply to a reply joins the same thread
rather than nesting further, because deep nesting turns a work discussion into
a maze. A reply's parent is verified to belong to the same milestone, so a
crafted `parentId` can't graft a thread from one record onto another.

**@mentions** are resolved by `lib/mentions.ts` — pure, dependency-free, 18
unit tests. Names contain spaces, so a naive `@\w+` would only ever match the
first word; matching runs against the roster instead, longest name first. A
first name only resolves when it is unique across the team: with two Ayeshas,
`@Ayesha` matches nobody, because notifying an arbitrary one of two people is
worse than notifying neither. Mentions are stored on the comment rather than
re-parsed later, so renaming someone can't silently change who was notified
about what.

**Attachments** upload to `/uploads` in dev. This is where this kind of app
usually goes wrong, so: the stored name is server-generated and is the only
thing that ever builds a path (the original filename is display data, making
`../../.env` just a label); reads resolve and verify containment before opening
anything; an allowlist gates types, with SVG deliberately excluded as
script-capable; and files are served through an authenticated route with
`nosniff`, a fixed content type and a sandbox CSP rather than static hosting.
Images get inline thumbnails, everything else downloads.

**Activity** logs status changes, reassignments, due-date moves, score events,
comments and uploads, written by the routes that change things so each entry
carries a readable sentence.

### Global additions

- **Cmd+K palette** over clients, projects, milestones and members, debounced,
  keyboard-navigable, scoped server-side by role.
- **Activity feed** on the owner's dashboard — the last 20 things that happened.
- **Focus today** on `/my-tasks`: the three most pressing items, ordered
  overdue → nearest deadline → heaviest. Three on purpose; a focus list of ten
  is just a list.

### Polish

A toast system replaced the per-page flash banners in the team, planner,
reports and tasks screens, so every mutation reports its outcome the same way.
Errors linger longer than successes — you may need to read them twice.

### Verification

- **75 unit tests** (39 scoring, 18 narrative, 18 mentions).
- **78 Phase 5 acceptance checks**, including the security boundaries:
  cross-member drags, cross-member drawer reads, cross-milestone reply grafts,
  SVG and oversized uploads refused, unauthenticated file reads refused, and a
  check that no stored filename contains path structure.
- **381 checks in total** across all five phases, re-run with no regressions.
- `tsc`, lint and build clean.

### Two bugs found and fixed

1. **The build broke** because `lib/uploads.ts` imported `node:fs`, and the
   drawer imported `formatBytes` from it — dragging Node built-ins into the
   browser bundle. `formatBytes` moved to `lib/utils.ts` and `uploads.ts` is
   now marked `server-only`, so the same mistake fails loudly at the import.
2. **The drawer rendered invisible.** Visual QA showed the panel translucent;
   its computed `opacity` was 0 *after* the animation had finished. The
   `fade-in` keyframe had no fill mode, so visibility depended on the animation
   actually running. Fill modes were added, and the drawer now animates on
   transform alone — if the animation is skipped entirely, the panel is still
   in its final position rather than invisible. Worth remembering: never let an
   element's visibility depend on an animation completing.

### Next up

Email delivery for notifications, and a client-facing portal reusing the client
weekly document.

---

## Phase 6 — Production readiness (8 August 2026) · **v1.0.0**

Postgres, email, scheduled jobs, hardening, and a full walkthrough of the loop
against a real database.

### Postgres, and the thing the brief asked for that Prisma forbids

The brief asked for an env-driven datasource provider. Prisma refuses:

```
error: A datasource must not use the env() function in the provider argument.
```

That was confirmed against Prisma 5.22 before designing around it, not assumed.
So the provider stays a literal, and `scripts/sync-db-provider.mjs` derives it
from the one variable that already differs between environments — the
connection string:

| `DATABASE_URL` | provider |
| --- | --- |
| `file:./dev.db` | `sqlite` |
| `postgresql://…` | `postgresql` |

It runs before `dev`, `build`, both seeds and every db command, so the schema
always matches the database being pointed at. Committing the SQLite variant by
accident is harmless — the next production build derives `postgresql` and
rewrites it. The outcome the brief wanted (one env var, both databases) without
pretending Prisma supports something it doesn't.

**Verified on a real Postgres**, not asserted: an embedded Postgres 16 was
booted, `prisma migrate dev` generated `20260808140428_init`, and
`migrate deploy` then ran against a *pristine* database — created fresh, never
touched by `db push` — followed by the seed. All 11 tables and every row landed.

One portability bug was caught in the process: **`contains` is case-sensitive
on Postgres** and case-insensitive on SQLite. Search would have worked in
development and quietly stopped matching case in production — the worst kind of
difference, because every local test passes. `lib/db-features.ts` now supplies
`mode: "insensitive"` when the target is Postgres.

### Email

SMTP through nodemailer, configured entirely by environment and **inert when it
isn't**: with no `SMTP_HOST`, messages are logged and reported as `skipped`
rather than thrown. Adding a member must not fail because a mail server is
down, and local development needs no SMTP at all. Any provider works — Resend,
Postmark, SES and Mailgun all expose SMTP.

Four messages, in the product's editorial style — dark header, green accents,
hairline rules — written as inline-styled tables, because email clients support
neither stylesheets nor modern CSS:

| | |
| --- | --- |
| **Welcome** | On member creation, carrying the generated password. That plaintext exists only in the request that set it, so this is the one chance to deliver it. |
| **Weekly digest** | Monday: this month's score and what is due in seven days. |
| **Report ready** | As each member report generates, with the narrative and a link. |
| **Overdue alert** | Daily to the owner, and only when something is actually late — no news is not worth an email. |

Every template escapes its input; a member's name is not a trusted source of
markup. 12 unit tests cover the copy, plural agreement and the escaping.

### Scheduled jobs

`vercel.json` registers three crons. Vercel schedules in UTC; the agency works
in UTC+5:

| Path | UTC | Karachi | |
| --- | --- | --- | --- |
| `/api/cron/evaluate` | `0 19 * * *` | 00:00 daily | Deadlines, scoring catch-up, close-out, overdue alert |
| `/api/cron/reports` | `30 19 * * *` | 00:30 daily | Generates whatever the calendar says is due |
| `/api/cron/digest` | `0 3 * * 1` | 08:00 Monday | The weekly digest |

`evaluate` runs at midnight Karachi because a deadline *is* the end of its due
day in that timezone. `reports` runs daily and decides for itself what is due,
so the calendar logic lives in code rather than in a cron expression.

`lib/cron-auth.ts` accepts two callers: Vercel Cron presenting `CRON_SECRET` as
a bearer token, or a signed-in owner. The comparison is length-checked and
constant-time — a plain `===` on a secret invites a timing oracle and costs
nothing to avoid. A wrong bearer token is refused outright rather than falling
through to the session check, so a failed machine call gets a 401 instead of a
redirect.

### Hardening

- **Every route was audited**: all 31 have server-side authorization, and every
  mutation that accepts a body validates it with zod. The client never decides
  a role.
- **Login is rate limited** — 8 attempts per 10 minutes, bucketed by *both* IP
  and account, so neither one machine grinding the roster nor a botnet grinding
  one account gets far. A sliding window, because fixed windows let an attacker
  fire a full quota either side of the boundary. Throttled attempts return
  exactly what a wrong password returns.
- **Passwords**: bcrypt, cost 10 for seeded accounts and 12 for the production
  owner.
- **Uploads**: 10 MB cap, type allowlist, SVG refused as script-capable,
  server-generated storage names, containment-checked reads, and authenticated
  serving with `nosniff` and a sandbox CSP.
- The counters are in-process, so each serverless instance keeps its own. That
  is stated in the README rather than left as a surprise; swapping
  `lib/rate-limit.ts` for Redis is a drop-in change.

### Deployment

`README.md` covers local setup, the provider-switching mechanism, Vercel +
Neon/Supabase deployment, the cron table, and the security posture.
`.env.example` documents every variable.

`prisma/seed-admin.ts` is the production seed: the owner and the service
catalogue, and **nothing else**. It refuses passwords under 12 characters and
rejects known defaults like `admin123` — shipping with the demo password
because someone forgot a variable is the failure mode worth designing against.
The demo seed stays available for local use.

### The walkthrough

The whole loop, run against real Postgres, asserting against the database
rather than the UI — **38 checks, all passing**:

onboard a client → 3 modules and 14 milestones generated from templates →
a member starts and submits → **cannot** approve → owner rejects with a reason
(charged) → member resubmits → owner approves (early bonus paid) → cycle end
moved into the past → evaluation marks the abandoned milestone MISSED, charges
it, and closes the cycle → re-running three times charges nothing extra →
reports generate with a written narrative → the score reads 27.5, matching
`100 + sum(events)` exactly → cron endpoints refuse no credentials, a wrong
secret and a member, and accept the right secret and the owner.

### Verification

- **86 unit tests** (39 scoring, 19 narrative, 18 mentions, 12 email — 11 added
  this phase).
- **419 HTTP checks**: 381 regression across phases 1–5 on SQLite, plus 38
  walkthrough checks on Postgres.
- `tsc`, `next lint` and the production build clean on both databases.

### Three bugs found and fixed

1. **`server-only` broke the seed.** The package throws outside a React Server
   environment, and the seed reaches report generation, which now reaches
   email. The guard stays on the transport; `dispatch.ts` imports it lazily,
   and `generateReports` gained a `sendEmails` flag so seeding a demo agency
   doesn't try to email six invented people.
2. **The build then caught a real layering problem.** `lib/reports.ts` mixed
   server generation with the labels and payload types that client components
   import — so Prisma, and now `server-only`, were being pulled into the
   browser bundle. Split into `lib/report-types.ts` (client-safe vocabulary)
   and `lib/reports.ts` (server generation). The bundle is smaller for it.
3. **Prisma logged handled collisions at error level.** Re-running evaluation
   or regenerating a report deliberately relies on a unique constraint firing;
   Prisma logged every one as an error before the caller caught it, so a
   healthy production log filled with "errors" that were the idempotency
   working. Logging is now warn-and-above, with genuine failures still logged
   by the catch that swallows them.

---

## v1.0.0 — what was built

Six phases, from an empty directory to a deployable product.

| Phase | |
| --- | --- |
| **1** | Design system, auth with three guard layers, team management |
| **2** | Clients, engagements, planning templates, the milestone planner |
| **3** | The scoring engine — pure, ledger-backed, exhaustively tested |
| **4** | Frozen-snapshot reports, printable to A4, and notifications |
| **5** | Kanban board, milestone drawer, comments, files, activity, search |
| **6** | Postgres, email, cron, hardening, deployment |

**Totals:** 86 unit tests, 419 HTTP acceptance checks, 30 routes, 11 tables.

The decisions that shaped it, in order of how much they mattered:

1. **The score is never stored.** `ScoreEvent` is append-only and a score is
   always `100 + sum(that month's events)`. There is no mutable score column
   anywhere in the schema, so a score can never disagree with its own history.
2. **Approval belongs to the owner.** Completion is what the score pays out on,
   so letting members self-approve would make the whole measure self-reported.
3. **Reports are frozen snapshots.** Reopening a milestone in October cannot
   rewrite what August's report said.
4. **Idempotency is a database guarantee**, not a convention — unique dedupe
   keys on score events, reports and notifications.
5. **A deadline is the end of its day in Asia/Karachi**, resolved in one place,
   so nothing is late from 05:00 local onwards.
6. **The pure core is pure.** Scoring, narratives and mentions have no
   database and no clock, which is the only reason they could be tested to this
   depth.

### Known limits

- **Rate limiting is per-instance.** Fine for seven people; needs Redis for a
  global limit across serverless instances.
- **Uploads are local files.** `save`/`read` in `lib/uploads.ts` are the only
  two functions to replace for S3 or Vercel Blob.
- **Migrations are Postgres-only.** Local SQLite uses `db push`.
- **The notification bell polls** every 60 seconds rather than holding a socket.
- **The rejection reason in the board drawer uses `window.prompt`** — validated
  and functional, but the one control in the app that isn't designed. The
  project planner has a proper modal for the same action.

---

## Phase 7 — Smart attendance with random availability checks (8 August 2026)

A remote agency has no doorway to walk through. This phase replaces the one
signal a physical office gives for free — is this person actually here — with
something a distributed team can run: a clock-in with a grace period, and
random, unannounced availability checks through the day that must be answered
inside a window.

The whole feature turns on one property, so it was designed around it first.

### Secrecy is the feature

If a member can discover when the next check lands, the check measures nothing.
So the scheduled times are treated as a secret with a single exit point:

```
lib/attendance-visibility.ts
  visibleCheck(check)   -> null for SCHEDULED. Always.
  visibleChecks(checks) -> resolved and active only, chronological
  visibleTally(checks)  -> passed / missed / cancelled / resolved
  adminTally(checks)    -> counts only, never a time
```

No member-facing payload is built by spreading a Prisma row. Every one of them
goes through this module, which means the guarantee is enforced in one file
rather than re-litigated in each of the six endpoints and four components that
touch a check.

Four consequences worth naming, because each is a leak that had to be closed:

- **`visibleTally` has no `total` and no `pending`.** A member who learns "3
  checks today" and can see two resolved knows the third is still ahead — and
  more usefully, knows when they are free. The tally counts what has finished
  and stops there.
- **`GET /api/attendance/me` withholds `checksPerDay`** from the settings it
  returns, for the same reason.
- **Clock-in returns `monitored: true`, not a count.** The response originally
  returned `checksScheduled: 3`. That is the same leak by another route, found
  while writing the walkthrough. Knowing the day is watched is the deterrent
  and is meant to be public; knowing how often is not.
- **Times are generated at clock-in, server-side**, from `crypto.randomInt` —
  the one moment the member cannot be observing the scheduler.

The test that matters isn't "no `scheduledAt` field". It serialises a payload
built around a known secret instant and asserts that neither the timestamp, nor
its epoch, nor the pending check's id appears anywhere in the JSON.

### The rules, exactly as specified

| Rule | Where |
| --- | --- |
| Shift 12:00–22:00 Asia/Karachi | `Settings.shiftStartMinutes` / `shiftEndMinutes` |
| Clock-in opens 11:30 | `clockInOpensMinutes` |
| After 12:15 → LATE, −0.5 | `graceMinutes`, `penaltyLateClockIn` |
| No clock-in by 15:00 → ABSENT, −3 | `absentCutoffMinutes`, `penaltyAbsentDay` |
| Missed check → −1 | `penaltyMissedCheck` |
| 3 checks/day, 60-minute window | `checksPerDay`, `checkWindowMinutes` |
| Not in the first 45 minutes, ≥90 minutes apart, none after 21:00 | `checkEarliestOffsetMinutes`, `checkMinGapMinutes`, `checkLatestMinutes` |
| Sundays and approved leave exempt | `workdays`, `LeaveRequest` |
| Unclosed days auto-close at 22:00 | `runDailyAttendanceSweep` |

Every one of these is a column in `Settings`, editable from the owner's
settings panel, so changing the working day is not a deploy.

Two derived rules exist because a configurable value can describe an impossible
day:

- `effectiveCheckLatest()` takes `min(checkLatestMinutes, shiftEnd − window)`.
  An owner who lengthens the window to 120 minutes without touching the latest
  check time would otherwise create checks that expire after everyone has gone
  home — and every one of them would be missed through nobody's fault.
- `feasibleCount()` degrades gracefully. Someone clocking in at 14:50 cannot
  fit three checks 90 minutes apart before 21:00, so they get two. The
  alternative — cramming them in — would punish a late start twice.

### Time, without trusting a clock

`lib/attendance-time.ts` is arithmetic, not `Intl`. Asia/Karachi is UTC+5 with
no DST, so every conversion is an offset:

```ts
export const KARACHI_UTC_OFFSET_MINUTES = 5 * 60;
```

The reason is not performance. A member's device timezone must never enter the
calculation of whether they were late — otherwise changing a laptop clock
changes a penalty. Nothing in the attendance path reads the local zone. One
test asserts the offset against `Intl` across four months of the year, so if
Pakistan ever adopts DST the suite fails rather than silently mis-scoring
everyone.

### Idempotency, again

A check can never charge twice. The mechanism is the same one the scoring
engine already used — a unique `dedupeKey` on `ScoreEvent`:

```
check:<id>:MISS            a missed availability check
day:<id>:LATE_CLOCK_IN     a late start
day:<id>:ABSENT            a day with no clock-in
excuse:<eventId>           the owner's reversal
```

This matters more here than anywhere else in the app, because there is no job
runner. Serverless has nothing running at 16:12 to fire a check, so state is
settled lazily: **any read of attendance advances it**. The member's own
60-second poll settles their checks; the owner opening the board settles
everyone's; the daily cron is the backstop for someone who never opens the app.
All three paths run the same `settleChecks()`, and the result is identical
because the transition depends on the clock, not on who asked.

The walkthrough re-reads state six times after a check expires and confirms the
ledger still holds exactly one penalty.

### Excusing, without erasing

The owner can excuse any attendance penalty. The original event is never
deleted or edited — a compensating `MANUAL_ADJUST` of the exact opposite value
is written alongside it, with a required reason of at least five characters,
attributed to the owner, and charged to the same cycle as the original.

Deleting would have been one line less code and would have erased the fact that
someone was late — and with it any pattern worth noticing. Both rows stay
visible in the ledger: what happened, and that it was set aside.

### What was built

**Data** — `AttendanceDay`, `AvailabilityCheck`, `LeaveRequest`, `Settings`,
plus three new score event types (`ATTENDANCE_MISS`, `LATE_CLOCK_IN`,
`ABSENT_DAY`). Migration `20260808170000_attendance`.

**Member** — a clock-in/out card at the top of the dashboard, a sticky
availability banner that follows them across every page, `/my-attendance` with
a month calendar and check history, and leave requests.

**Owner** — `/attendance` with four tabs: a live board that refreshes every
minute, a members × days matrix with CSV export, a leave inbox, and the
settings panel. Plus a "Team present today" figure on the dashboard.

**Integration** — the daily sweep runs first inside `/api/cron/evaluate`, so
absences and missed checks land in the ledger before any report is frozen.
Monthly member reports gained an attendance section (days present, late,
absent; checks passed; average response time) and a narrative sentence:
*"You passed 44 of 51 availability checks this month."*

The narrative keeps delivery and attendance apart. The trouble-area qualifier
is a module name, so "2 absent days in Google Ads" would blame a service for
somebody's absence. Delivery problems get *"Watch out: …in Google Ads"*;
attendance gets its own *"Also on the record: …"*.

### Verification

- **135 unit tests** (49 added this phase: 20 time, 12 schedule, 12 visibility,
  5 narrative).
- **40 walkthrough checks** through the real HTTP API with real sessions:
  sign in as Subtain → clock in → confirm the three generated times appear
  nowhere in their payload → owner triggers a check → pass it → owner triggers
  and expires another → one penalty, still one after six re-reads → a closed
  window refuses a late answer → the board reads 1 passed / 1 missed / 1
  pending → excuse the penalty (original kept, reversal exact, second attempt
  409s) → request and approve leave → CSV export → clock out, and the third
  check is **cancelled, not missed**.
- **Access control**: a member gets 403 on the board, the matrix, settings and
  the test trigger, and 307 off `/attendance`.
- **Migration verified on real Postgres** — `migrate deploy` from empty, then
  inserts proving the `(userId, date)` unique index, the `dedupeKey` unique
  index, the nullable `milestoneId`, and that the `Settings` defaults land.
- `tsc`, `next lint` and the production build clean.

### Two bugs found

1. **`ProposedEvent.milestoneId` was `string`, not `string | null`.** Every
   score event before this phase belonged to a milestone; attendance events
   belong to nobody. Writing `""` to satisfy the type violates the foreign key.
   Confirmed with a real insert — *"Foreign key constraint violated"* — before
   widening the type and having `applyEvents` write `?? null`. This would have
   crashed clock-in in production on the first late arrival.
2. **Clock-in leaked the number of checks.** Covered above. Found by writing
   the assertion first and watching it fail.

TypeScript caught a third on its own: adding three event types made the
`Record<ScoreEventType, …>` icon maps in `PerformanceProfile` and
`MemberReportDocument` incomplete. Exhaustive records earn their keep.

### Known limits

- **The test trigger is gated but real.** `/api/attendance/dev-trigger` refuses
  to run unless `ALLOW_TEST_TRIGGERS=1` or the build is non-production, because
  in production it would be a way to manufacture or dodge penalties. The owner
  UI hides the buttons under the same condition and shows a warning banner when
  they are live.
- **Check settlement is lazy.** A member who never opens the app has their
  checks settled by the daily cron rather than the minute the window closes.
  The score is the same; the board is up to a day stale for that person.
- **Auto-closed days carry no penalty** in v1. The day is flagged so the owner
  can see it happened.
- **Leave is a single day per request.** A week off is seven requests.

---

## Phase 8 — Fairness corrections (8 August 2026) · **scoring engine v2**

Four corrections to rules that were quietly measuring the wrong thing. Three of
them change how points are calculated, so this is the first phase to version the
scoring engine.

### Engine v2, and why nothing was recomputed

Version 1 charged `LATE` and paid `EARLY_BONUS` against `completedAt` — which is
stamped when the **owner approves**. A member could submit a day early and still
be charged for a late delivery, because the review sat for three days. The
score was partly a measure of the owner's inbox.

Version 2 judges `submittedAt`. Approval no longer times anything.

Both rules apply **from the deploy date forward**. Nothing is recomputed:

- The ledger is append-only, and events already in it were correct under the
  rules in force when they were written.
- Reports are frozen snapshots that quote those events. Rewriting history would
  make August's report disagree with itself.

Three corollaries fell out of the change, each of them a place where the old
basis was leaking:

- **`evaluateMissed` no longer charges submitted work.** Delivered means
  submitted. Work sitting in the review queue when a cycle closes is the owner's
  backlog, and `weight × 4` for it is the same unfairness by another route.
- **Close-out skips `SUBMITTED` and `BLOCKED` milestones entirely** rather than
  flipping them to MISSED.
- **`onTimeRate` moved too**, and onto milestones *due* in the cycle rather than
  *approved* in it — so the figure answers "did this month's work land on time"
  instead of "how much did the owner get round to signing off".

### The blocked clock

`BLOCKED` is a real status with a timed period behind it. Entering it needs a
reason (`CLIENT` / `INTERNAL_DEPENDENCY` / `EXTERNAL`) and a written note of at
least ten characters; leaving it closes the period and banks the minutes, which
`effectiveDeadline()` adds to the deadline.

Three decisions worth naming:

- **`BlockPeriod` is the record, not a flag on the milestone.** A milestone can
  be blocked and released repeatedly for different reasons, and attributing
  delay to a client needs each period separately. `Milestone.blockedMinutes` is
  a cache of their sum, maintained transactionally.
- **BLOCKED is absent from both transition matrices in every direction.** It is
  not a column you drag a card into — the clock has to be opened and closed
  atomically with the status, so both go through `/api/milestones/[id]/block`.
  Dragging a card out of BLOCKED would otherwise silently lose the pause.
- **A veto keeps the period.** The owner can overrule a block with a written
  reason; the period stays on the record marked `vetoed` and contributes no
  time. Deleting it would erase the fact that someone tried.

Completing a milestone releases everything waiting on it and tells each
assignee by how much their deadline moved.

**Client accountability** falls out for free: `clientBlockedDays()` aggregates
un-vetoed `CLIENT` periods per client. It surfaces as a "Waiting on this client"
card and as an *Items awaiting your input* section in the client weekly —
phrased as a prompt to unblock, and incidentally the record if a deadline is
ever disputed.

### The owner is accountable too

The trade for taking review time out of members' scores is that the wait became
the owner's number:

- **Awaiting your review** on the dashboard, longest wait first, with an age
  badge — green under 24h, amber to 48h, red past that — and approve/reject in
  place. A queue you have to leave to clear is a queue that doesn't get cleared.
- `adminReviewMinutes` recorded on every decision, approvals and rejections
  alike, and an average shown to the owner only.
- Anything past the configurable SLA (default 48h) notifies daily until cleared,
  deduped per milestone per day.

No penalty attached, deliberately. The owner has no monthly score to deduct
from, and inventing one would be theatre. What changes behaviour is the queue
being visible with an age on every row.

### Volume context, everywhere

A raw score is never rendered alone. `<PerformanceBadge/>` is the only component
that draws one, so the rule holds by construction rather than by everyone
remembering it: **score · on-time % · load**.

- The team table splits the triple into three sortable columns and **defaults to
  on-time rate**, because the raw number is the least comparable of the three.
- Unrated members show an em dash and sort last in both directions — a red 0%
  for someone with nothing yet due is a false accusation.
- The narrative carries it: *"Your score of 91 places you in the Excellent band,
  carrying the heaviest load on the team — 31 milestones."*
- Both member-facing lists carry a footnote saying what the number is and isn't.

### Reachability, outages and protected breaks

**PWA.** Installable, with a manifest, a service worker and icons generated by
`scripts/generate-icons.mjs` — a hand-rolled PNG encoder rather than a build
dependency, so the mark inherits the palette in CLAUDE.md instead of drifting
from it. The worker does two things and deliberately no third: it shows pushes
and serves an offline page. It does **not** cache app routes; every screen here
is live data, and a stale cached dashboard is worse than no dashboard.

**Push** is opt-in, asked once, and remembered. Browsers permanently block a
site that calls `requestPermission()` on load, and a member asked every morning
will block it out of irritation — at which point the one genuinely time-critical
alert in the product can never reach them again.

**WhatsApp** is env-gated and fires for availability checks only.

**Outages.** A member declares a power cut or dropped link; any check whose
window overlaps goes to `PENDING_REVIEW` instead of `MISSED`, and nothing is
charged until the owner decides. Filing after a check has already expired is
explicitly allowed and flagged rather than refused — an outage stops you filing
about it, so refusing late reports would deny the excuse to exactly the people
with the worst outages. Upholding one writes a compensating `MANUAL_ADJUST`;
the original penalty is never deleted.

**Breaks.** 90 protected minutes a day, configurable, never penalized. While a
break is open, checks neither activate nor expire — protected time cannot cost
points. On return, a check the break swallowed is shifted; one that no longer
fits before the 9PM cutoff is **CANCELLED, not MISSED**. A check the member was
never actually put is not one they can fail.

One rule keeps that from being an escape hatch: **a break cannot be started
while a check is ACTIVE.** Without it, "check fires → tap On break → immune"
would make the entire availability system optional.

### Verification

- **171 unit tests** (25 added: 10 for the submission basis and blocked clock,
  11 for interval and break arithmetic, 4 for the load narrative).
- **55 walkthrough checks** through the real HTTP API: an on-time submission
  approved two days late costs nothing while the owner's 53 hours are recorded
  · a genuinely late submission still charges −8 · rejection clears
  `submittedAt` so the resubmission is what gets timed · a block is refused
  without a real note, banks 2,880 minutes on release, and a day-late submission
  after it costs nothing · a member cannot overrule their own block, the owner
  can, and the vetoed period is kept · completing a blocker auto-releases its
  dependent · a member gets 403 on the review queue · a break cannot be started
  to dodge a live check · an outage over the cap, in the future, or rejected
  without a reason is refused, and upholding one reverses the charge without
  deleting it.
- **Migration verified on real Postgres** — `migrate deploy` from empty, then
  inserts proving the `Milestone` self-relation, the check→outage FK, the unique
  push endpoint, the Phase 8 `Settings` defaults, and `BlockPeriod` cascade.
- `tsc`, `next lint` and the production build clean.

### Two bugs found

1. **Close-out was about to charge the owner's backlog.** `evaluateMissed` now
   refuses submitted work, but `closeOutEndedProjects` was still flipping every
   non-COMPLETED milestone to `MISSED` — so a submission awaiting approval when
   a cycle closed would have been marked missed even though it charged nothing.
   Blocked work had the same problem, and worse: its deadline had been moving
   the whole time. Both are now excluded.
2. **The build caught a layering problem, again.** `lib/review-sla.ts` reaches
   `lib/reach.ts`, which reaches `web-push`, which reaches `node:https` — and a
   client component was importing a colour map from it. Same shape as the
   Phase 6 `lib/reports.ts` split. Fixed by `lib/fairness-types.ts`: block
   reasons, review ages, labels and `describeBlocked`, with no imports at all.
   Any `"use client"` file imports from there.

### Known limits

- **`adminReviewMinutes` records the most recent decision**, not a history. The
  average is over milestones, so a milestone rejected and re-reviewed counts its
  last review only.
- **Break time doesn't extend the shift.** 90 minutes of protected break inside
  a ten-hour shift is nine and a half hours of work, and that is intentional —
  but it means a member using the full allowance has fewer hours in which checks
  can land.
- **Outage reports are trusted until reviewed.** A member could file one over a
  window they were simply absent for; the monthly cap and the owner's judgement
  are the only checks on it, which is the right trade at five people.
- **The rejection prompt in the board drawer still uses `window.prompt`.** The
  new review queue has a proper modal for the same action and is now the primary
  path, so the drawer's version is a fallback rather than the main route.

---

## Phase 9 — Growth systems (8 August 2026)

Three systems: one that grows revenue, one that deletes the owner's most
reliable recurring chore, and one that stops overload before it becomes a
penalty.

### The sales pipeline

`Lead` is a separate model from `Client`, not another client status. A lead has
a stage, an owner, an estimated value and an activity history that a signed
client has no use for; a signed client has projects and milestones a lead must
never accidentally acquire. Winning one converts.

**Stages are permissive in both directions.** A deal that goes back from
NEGOTIATION to CONTACTED is a real thing, and a state machine that forbade it
would get worked around by deleting and re-creating the lead — losing the
activity history that makes the pipeline worth having. The two closed stages
are the exceptions: LOST demands a reason, and WON pays out exactly once
(`lead:<id>:WON`), so dragging a card out and back in cannot mint a second
bonus.

**Losing takes a fixed reason plus free text.** Free text alone is unqueryable,
and the entire value of recording a loss is counting them: six deals lost on
price in a quarter is a pricing decision, six paragraphs about six
conversations is nothing at all.

**Logging work advances the deal.** Sending a proposal means the deal is at
least at PROPOSAL_SENT. The advance is forwards-only, so logging a follow-up
call on a deal in NEGOTIATION doesn't drag it back to CONTACTED.

**Converting is a read, not a write.** `GET /api/leads/[id]/convert` hands the
existing onboarding wizard a pre-filled draft — services from
`interestedServices`, budget from `estimatedMonthlyValue`. Converting silently
in the background would create a client and a month of dated work nobody
looked at.

### Business development, scored

Sales work doesn't decompose into dated deliverables, so it is scored on
activity and outcomes — into the **same** ScoreEvent ledger, so a score stays
`100 + sum(that month's events)` however it was earned. Three new types:
`DEAL_WON` (+3), `TARGET_MET` (+1), `TARGET_MISSED` (−1).

**Targets are set on buckets, not raw activity types.** "40 outreach a week" is
a number a person can hold in their head. "14 calls, 18 emails and 8 DMs" is
three targets that trade off against each other, and hitting the number by
picking the cheapest channel is a worse outcome than letting them choose.

**The asymmetry is deliberate.** Hitting a target is +1; missing one only costs
a point below 60% of the number. A target you fall 5% short of after a real
week is not a failure, and charging for it makes people pad the count with
cheap activity — exactly the behaviour a target exists to prevent.

The bar on the member's dashboard renders from the same `evaluateWeek` the
Sunday job uses, so the number they watch all week and the points they end up
with cannot disagree. Events are keyed
`target:<user>:<bucket>:<weekStart>` and dated to the end of the week they
describe, so a Monday-morning run lands them in the right month.

### Money

MRR leads the owner's dashboard — the number the whole machine exists to grow —
with six months of trend as hand-drawn SVG. Six points and a fill is not worth
40kB of charting library, and it inherits the palette instead of fighting a
library's defaults.

**The history is snapshotted, not derived.** MRR today is a sum over active
clients, but its past is not: a client who churns in March takes February's
number with them. `MrrSnapshot` records it monthly; the current month reads
live so onboarding a client moves the headline immediately.

**Win rate is over closed deals**, won ÷ (won + lost). Including the open
pipeline in the denominator would make the rate fall every time somebody added
a lead — precisely the behaviour you want to encourage.

### Auto-renewal

Overnight, every ACTIVE client whose cycle has ended gets the next one: same
modules, same milestones, same assignees, dates shifted by the length of the
cycle.

**Cloned from the previous cycle, not from the service templates.** A month of
edits, added milestones and reassignments is exactly the knowledge a template
regeneration would throw away.

**The window is preserved, not snapped to a calendar month.** A client
onboarded on the 12th is on a 12th-to-11th cycle; snapping their renewal to the
1st would silently give them a short month and move every deadline they had
already agreed to.

**No double punishment.** Unfinished work is copied with `carriedOver` set, a
new deadline a few days into the cycle, and none of the original's status,
timestamps or block history. The MISSED penalty was charged in the closed cycle
and is never charged again. Carried work is dated a few days in rather than to
day one, because it arrives alongside a full new month and day one guarantees
it is late again immediately.

**Idempotent by unique index.** `Project.renewedFromId` is unique, so a cycle
can be rolled forward exactly once — a second run finds the child already there.

Ordering inside the nightly job is load-bearing: **renewal runs after
close-out**, because close-out is what charges the MISSED penalties for the
cycle that just ended. Reversed, the carried copies would exist before the
originals were settled and the same work could be charged in both cycles.

The owner gets one digest — notification and email — rather than one notice per
client, listing what renewed, what carried over, and what needs a decision.

### Capacity planning

`Milestone.estimatedHours` and `User.weeklyCapacityHours`, measured per ISO
week because a week is the unit people plan in. A monthly figure hides that
four of someone's five milestones are due in the same three days.

**The load bars are in the assignment control**, not on a page somebody would
have to think to open — the whole point is preventing overload rather than
diagnosing it afterwards from the misses it caused.

**The hard dialog fires at 100%, not at the amber band.** A warning that fires
whenever somebody is merely busy gets clicked through without reading, and then
the one that matters gets clicked through too.

**The suggestion prefers a qualified member over an idle one.** It breaks ties
inside a discipline; it must never propose reassigning Meta Ads to the Shopify
designer because they happen to be free.

`/team` gains a Utilization tab: members × eight weeks as a heat grid, because
the failure this makes visible is *imbalance*, and that pattern only shows up
when everybody is on the same axis.

### Verification

- **235 unit tests** (64 added: 24 targets, 22 capacity, 18 renewal
  arithmetic).
- **47 walkthrough checks** through the real API: a member can add and own a
  lead but not reassign or edit someone else's · logging a call advances the
  stage and a follow-up never drags it back · LOST without a reason is refused
  · winning credits +3 and re-winning cannot mint a second · the wizard draft
  arrives pre-filled and converting twice 409s · a converted lead can't be
  deleted · a member can't set their own target or read another's · the Sunday
  settlement is idempotent · the suggestion prefers a qualified member · a
  cycle rolls forward with unfinished work flagged and delivered work simply
  recurring, then does nothing on a second run · a client with auto-renew off
  is skipped · MRR leads the owner's dashboard and is absent from a member's.
- **Migration verified on real Postgres** — every unique index that carries a
  correctness guarantee (one target per bucket, one snapshot per month, one
  renewal per cycle), both new self-relations, and that a lead outlives its
  owner.
- `tsc`, `next lint`, production build and the seed all clean.

### One bug, and one comment that lied

The walkthrough caught an assertion of mine failing, and the failure turned out
to be in the **comment**, not the code. `shouldCarryOver` returns false for
SUBMITTED, and the docblock claimed that meant submitted work "stays in the
closed cycle". It doesn't — *every* milestone is cloned into the next cycle,
because a retainer's work recurs. What the flag actually decides is narrower:
whether the copy is marked `carriedOver` and re-dated close to the start
because the original was never delivered. The behaviour was right; the comment
described a different system, which is worse than no comment. Fixed in
`lib/renewal-plan.ts`, in the test that asserted it, and in the walkthrough.

Also: the renewal digest email reaches `lib/email/send.ts`, which is
`server-only` and throws outside a React Server environment — the same Phase 6
trap. It was already caught and degraded gracefully, but it logged a stack
trace on every seed and CLI run that looked like a failure. Now one quiet line.

### Known limits

- **Stage conversion in reports is a snapshot, not a funnel.** It reports where
  a member's pipeline stands by stage, not how many deals passed through each —
  that would need a stage-transition log this schema doesn't keep.
- **Capacity counts a milestone in the week it is due**, not spread across the
  days it will actually take. Fine at 2–8 hour granularity; wrong for a
  40-hour milestone, which should be split anyway.
- **Renewal clones the last cycle even if it was heavily edited mid-month.** A
  one-off milestone added in August reappears in September and has to be
  deleted. Cloning the previous cycle is still the better default than
  regenerating from templates, but it isn't free.
- **MRR counts ACTIVE clients at full monthly budget** from the day they are
  onboarded, with no proration for a mid-month start.

---

## Phase 10 — Outcomes (8 August 2026)

Four systems that move the product from measuring *whether we did what we said*
to measuring *whether it was worth doing*.

### Quality at approval

Approving work now means judging it. A 1–5 rating is mandatory, and anything at
two or below demands a written comment — a low score the member cannot act on
is just a number that makes them feel bad.

**Three and four stars move nothing, deliberately.** Most work is simply fine.
A scale where every rating shifts a score pushes an owner towards rating
everything a 4 to avoid a conversation, and the measure dies. Only the ends
carry weight: five stars is +0.5, one or two is −1.

**The amounts are smaller than a missed deadline on purpose.** Lateness is
objective; a star rating is one person's judgement on one afternoon. It should
nudge a score, not decide it.

The dialog shows the score impact while the owner picks, because a rating with
a hidden consequence is a trap. Average quality becomes the fourth metric
beside the Phase 8 triple — score · on-time · load · stars.

### Client KPIs

`ClientKpiEntry` holds one week per client: two spend figures, revenue, orders,
sessions. **ROAS and conversion rate are never stored** — they are ratios of the
columns beside them, and a stored ratio is a number that can disagree with its
own inputs the moment one is corrected.

**Null, not zero, when a denominator is empty.** A week with no spend has no
ROAS. Reporting 0.0 would put it below every target and fire an alert about a
week nobody ran ads in — the same reason a paused week *breaks* an
under-target streak rather than extending it.

The entry form is one column with numeric keypads and defaults to last week,
because the person with these numbers is whoever ran the campaigns and they are
typing on a phone between other things. The derived figures update live: seeing
ROAS appear as you type catches a fat-fingered revenue before it becomes a
false alert.

Charts are recharts, in the palette from CLAUDE.md — three separate charts
rather than one with three axes, because a dual-axis chart lets you draw any
two series as though they move together, which is precisely the misreading a
client conversation doesn't need.

**The alert needs two consecutive weeks, not one.** A single bad week is noise —
a creative refresh, a stock-out, a holiday — and an alert that fires on noise
gets muted, at which point it can never warn about the real thing. It goes to
the owner *and* whoever runs that client's ads: an alert that only reaches the
owner turns into the owner relaying it, which is the manual chasing this
product exists to remove.

Manual entry is v1 by design. `lib/integrations/` documents where the Google,
Meta and Shopify APIs would attach, and names the two decisions that have to be
made first — manual corrections must win over a sync, and a *failed* sync has
to be visible, because a chart that quietly stops updating is worse than no
chart.

### Retainer payments

Payment lives on `Project`, not `Client`: the cycle is what gets invoiced, and a
client three months in with two paid and one outstanding cannot be described by
a single flag.

Overdue is measured from the cycle's **start**, not its end — a retainer is
billed up front, so unpaid on the 8th is late even with three weeks to run. The
transition only ever moves PENDING → OVERDUE, so a paid cycle stays paid.

MRR now splits collected from outstanding, because agreed and arrived are
different numbers and only one of them pays salaries. Auto-renewal still opens
the next cycle regardless — stopping work over an invoice is a commercial
decision, not one a 2am job should make — but the digest names the clients
whose last cycle went unpaid, so the owner has the conversation deliberately.

### Client health

One number from four things that actually predict a churn: delivery, ROAS
against target, payment, and days our work spent waiting on them. The formula
is one documented pure function with 34 tests.

Three decisions worth naming:

- **No manual input, ever.** A health score somebody types is an opinion with a
  number attached, and it decays the moment whoever maintained it gets busy.
- **A dimension with no evidence is dropped and its weight redistributed**,
  not counted as zero. A brand-new client with no campaign data isn't
  performing badly — nothing is known yet, and scoring the unknown as failure
  would mark every new retainer at risk on day one. The on-time rate is
  likewise ignored below three delivered milestones: one late out of two is a
  50% rate that means almost nothing.
- **At target scores 80, not 100.** There is headroom to reward genuine
  outperformance, and "exactly on target" shouldn't read as a perfect
  relationship.

Delivery uses the Phase 8 submission basis against the blocked-adjusted
deadline — the same rule members' own scores use, so a client's delivery number
and a member's cannot tell different stories.

Every client card carries a coloured dot; the dashboard carries the worst five,
each naming *why* rather than only how bad.

### Verification

- **290 unit tests** (55 added: 21 KPI arithmetic and the alert rule, 34 health).
- **42 walkthrough checks** through the real API: approving without a rating is
  refused · a low rating without a comment is refused · five stars credits +0.5,
  two stars charges −1 with the comment in the ledger, four stars moves nothing
  · a member can read and log KPIs but not delete a week · a correction replaces
  rather than duplicates · a future week is refused · logging a below-target
  week fires the alert to both ADMIN and MEMBER, and re-saving doesn't re-notify
  · the underperforming client scores lower and the headline names why · an
  unpaid cycle goes overdue once and a paid one is never re-marked · a member
  sees no collections.
- **Migration verified on real Postgres** — the one-entry-per-client-per-week
  unique index, the upsert that makes corrections safe, Phase 10 settings
  defaults, and that a KPI entry outlives whoever typed it.
- `tsc`, `next lint`, production build and the seed all clean.

### Two bugs found

1. **The same ROAS was rounded in one path and raw in another.** `deriveWeek`
   rounds to two places; `alertsForClients` computed `revenue / spend` straight.
   A client reading "2.17" on screen while the health headline said
   "2.1699471915506483" is one number pretending to be two. Both round now.
2. **The seed wrote KPI rows directly, bypassing the alert.** The demo showed a
   "Performance attention" chip with no notification behind it — a chip with
   nothing to click through to. The seed now calls `checkRoasAlert` after
   writing a client's weeks, and the walkthrough exercises the real save path
   rather than trusting the seed.

### Known limits

- **Collections amounts come from `monthlyBudget`**, not from a stored invoice
  total. There is no invoicing model here and inventing one would be a bigger
  feature pretending to be a smaller one; `invoiceNote` carries the difference.
- **Nothing alerts on *missing* KPI weeks.** The alert fires on low ROAS. A
  client whose numbers simply stop being entered looks stable, and that gap
  will matter more once a sync exists — it is called out in
  `lib/integrations/README.md`.
- **A changed quality rating doesn't adjust the ledger.** The event is keyed per
  milestone, so re-approving cannot double-charge, but correcting a 2 to a 4
  needs a manual adjustment. Correct for an append-only ledger; still a manual
  step.
- **Health has no memory.** It is computed fresh each time, so the dashboard can
  say a client is at risk but not that they have been sliding for a month.
