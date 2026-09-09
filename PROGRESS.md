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

---

## Phase 11 — The business runs without the owner (8 August 2026) · **v2.0.0**

Four systems so the agency keeps working — and keeps being fair — when the one
person who could approve anything is unavailable.

### Service leads

A member who leads a service line carries the owner's approval authority inside
it: approving and rejecting work with the Phase 10 quality rating, excusing
availability checks, ruling on outages and disputes, and seeing their pod's
numbers.

Two limits, both enforced server-side in `lib/permissions.ts` — a pure module
with 34 tests, because this is the file that decides whether somebody can
approve their own work:

1. **A lead can never act on themselves.** Not their milestones, not their
   attendance, not their disputes, and not a dispute about a charge they raised
   — which is the same conflict one step removed. It is not overridable by
   configuration.
2. **Authority stops at the service boundary.** Leading Google Ads confers
   nothing over a Shopify build.

The self-check runs *before* the scope check, so a lead looking at their own
out-of-scope milestone is told "you can't decide on your own work" rather than
the less useful "outside your service lines".

**Review routing.** A submission goes to its service lead first. After the
escalation window the owner is *added* rather than the lead being *removed* —
delegation must not become a place work goes to die, but taking the lead off it
would punish them for a busy Tuesday. When the lead is the assignee it routes
straight to the owner instead of sitting in a queue nobody may legitimately
clear. Average decision time is now measured **per reviewer**: a lead who sits
on approvals does the same damage the owner was doing before Phase 8, and
measuring only the owner would quietly exempt them.

**A second owner.** `npm run promote -- someone@agency.local`, a script rather
than only a button, because the situation you most need a backup owner in is
the one where the only existing owner cannot sign in. It refuses to remove the
last active owner.

### The incentive engine

**Excellence streak** — three consecutive months at 90+. **Performance review**
— two of the last three below 60. The asymmetry is deliberate: a bonus rewards a
*sustained run*, a review catches a *pattern*, and making both work the same way
would either trivialise the bonus or make the review trigger-happy.

Members see only their own streak, framed as progress toward something. The
review rule is stated plainly on the scoring page but never counted down at
anyone — a member having a bad run does not need a card ticking towards a
difficult conversation.

Evidence is **frozen into the award** when it is raised: the score events, the
attendance summary, the disputes. A review conversation two weeks later has to
be about the same numbers that raised it.

### Formal disputes

Any deduction can be challenged within seven days, from the member's own ledger
row — the moment of disagreement is when someone is looking at the charge, not
later when they have to remember to find a form.

Whichever way it goes, **the original event survives**. A reversal writes a
compensating `MANUAL_ADJUST` beside it, charged to the same cycle as the
original so reversing a March charge in April credits March. A written response
is mandatory on *either* outcome, because upholding in silence is exactly what
this replaces.

The monthly reversal rate never appears without its sentence. A high rate is a
measurement of the **rules**, not of the people filing — the honest response is
to change the thresholds, and a bare percentage invites the opposite reading. A
zero rate gets questioned too: it means either well-calibrated scoring or
challenges not getting a fair hearing, and the answer is in the response notes.

### Culture and ops

**Leaderboard visibility** defaults to owner-only. Ranking five people against
each other makes fourth place feel like failure when fourth of five at 88 is a
good month, so members get their own numbers and their own trend — "your best
month yet", "up 4 points on last month" — measured against their own past.

**`/api/health`** is unauthenticated: a monitor cannot hold a session, and a
health endpoint behind auth only tells the truth when you are already logged in.
It answers 503 **only** when the database is unreachable; a late backup is a 200
with `"status": "degraded"`, because paging someone about a stale snapshot as
though the app were down is how alerts get muted. Every scheduled job stamps a
`JobRun` row, and a one-line widget on the dashboard turns a silently dead cron
into the only red thing on a page of healthy numbers.

**Backups.** The managed provider's snapshots are the primary path and the
README says so first. This job is a second copy and a liveness signal; where
`pg_dump` is absent — Vercel — it records **SKIPPED**, because a backup system
that reports success when it did nothing is worse than none. The restore
procedure is documented, restores to a *new* database, and ends by re-running
the idempotent evaluation pass.

**`/admin/audit`** records every exercise of authority with a before/after diff
of only the fields that moved. "Adjusted a score" is a note; "−2 → 0 on this
event, by this person, at this time" is a record.

### Acceptance: a full month with the owner sealed out

The walkthrough runs the whole business end to end and **counts owner
requests** during the blackout rather than trusting the script to behave — any
call through the owner's session while sealed fails the run. It reported zero.

Lead logged → activities → won (+3 to the closer) → owner converts and a
14-milestone plan generates → **owner goes dark** → work submitted and routed to
the ads lead → the Shopify lead is refused for being out of scope → the ads lead
approves at 4 stars, tagged delegated → the ads lead is refused on their own
milestone and it is absent from their queue → a block, a missed check excused by
the lead, the original charge surviving → a dispute filed, ruled by the lead,
points returned with the original intact → seven nightly passes → month close
awards the streak, re-running awards nothing → **owner returns** and sees every
queue, each reviewer's average, and seven delegated actions in the audit log.

- **351 unit tests** (61 added: 34 permissions, 27 incentives).
- **51 acceptance checks**, plus **14 Postgres migration checks** covering every
  unique index that carries a correctness guarantee and that the audit trail
  outlives the actor.
- `tsc`, `next lint`, production build and the seed all clean.

### Two bugs the acceptance run found

1. **An empty month scored 100 and counted toward the excellence streak.** A
   score is `100 + sum(events)`, so a month with no events is a perfect month —
   correct for someone who had a clean month, completely wrong for a month
   nobody was here. Every member of a brand-new agency would have earned a bonus
   after three months of an empty database, and anyone on extended leave would
   have accrued a streak for doing nothing. A month now only counts with
   evidence of work: score events, days worked, or milestones that came due. The
   walkthrough caught it because a three-month setup reported a seven-month
   streak.
2. **The status route swallowed the useful refusal.** A lead trying to approve
   their own work got the generic "only the owner or the service lead can do
   that" instead of "you can't decide on your own work — this one goes to the
   owner". The permission layer produced the right message; the route replaced
   it with its own.

### Known limits

- **A pod is computed from live assignments.** A lead's attendance authority
  covers whoever currently has work in their service lines, so it shifts as work
  is reassigned. Correct for a team of five that shuffles constantly; it would
  need a real membership model at twenty.
- **Dispute file attachments are modelled but have no upload route.** The
  `DisputeFile` table and the relation exist; the member writes their case in
  text and links to evidence. Wiring it to the Phase 5 upload path is small.
- **The audit log has no retention policy.** It grows forever, which is right
  for now and will want thought before it is years old.
- **Incentive amounts are a payroll reference.** This app never moves money, and
  making it look like it does would be a much larger feature wearing a smaller
  one's clothes.

---

## v2.0.0 — what eleven phases built

| Phase | |
| --- | --- |
| **1** | Design system, auth with three guard layers, team management |
| **2** | Clients, engagements, planning templates, the milestone planner |
| **3** | The scoring engine — pure, ledger-backed, exhaustively tested |
| **4** | Frozen-snapshot reports and notifications |
| **5** | Kanban board, milestone drawer, comments, files, activity, search |
| **6** | Postgres, email, cron, hardening, deployment · **v1.0.0** |
| **7** | Smart attendance with random availability checks |
| **8** | Fairness corrections — scoring engine v2 |
| **9** | Growth — pipeline, auto-renewal, capacity planning |
| **10** | Outcomes — quality ratings, client KPIs, payments, health |
| **11** | Delegation, incentives, disputes, audit · **v2.0.0** |

**Totals:** 351 unit tests, ~250 HTTP acceptance checks across the phases, 70
routes, 27 tables.

The decisions that shaped it, in order of how much they mattered:

1. **The score is never stored.** `ScoreEvent` is append-only and a score is
   always `100 + sum(that month's events)`. Every correction since — excusals,
   vetoes, dispute reversals — writes a compensating entry rather than editing
   one, so the ledger can always explain itself.
2. **Nobody approves their own work.** True of members since Phase 3 and of
   service leads since Phase 11. It is the one rule with no configuration
   switch.
3. **Fairness is a functional requirement, not a courtesy.** A scoring system
   people believe is unfair gets gamed or ignored. Phase 8 moved lateness onto
   submission, paused the clock for blocked work, and made the owner's review
   time the owner's problem — and every phase since has had to hold that line.
4. **Idempotency is a database guarantee**, not a convention. Unique dedupe
   keys on score events, reports, notifications, renewals, targets and awards.
5. **The pure core is pure.** Scoring, narrative, capacity, health, permissions
   and incentives have no database and no clock, which is the only reason they
   could be tested to this depth.
6. **Secrecy where it changes behaviour.** Availability check times exit through
   one visibility gate, and a test asserts the secret never appears in a
   serialised payload.

### What would need attention before this scales past a dozen people

- Rate limiting is per-instance; a global limit needs Redis.
- Uploads are local files — two functions in `lib/uploads.ts` to replace.
- Pods, leaderboard framing and the review queue all assume a small team.
- The ad-platform integrations are documented but unbuilt (`lib/integrations/`).

---

## Stabilisation — route audit and error visibility

No new features. Eleven phases of schema changes had left pages that were
reported as rendering the error boundary, and the job was to find them at the
root and make the next one impossible to miss.

### What the reported breakage turned out to be

`/clients` was the confirmed example. It does not reproduce. It was exercised
in development and against a production build, with the seeded database and
with an empty one, as owner, as service lead and as member, and with all eleven
interactive controls on the page clicked one at a time in a real browser. It
renders cleanly in every one of those.

That is not a claim the report was wrong. It is the finding: **a page failed
and left no evidence.** Nothing recorded the route, the stack or the time, so
the only way back to the cause was guesswork — which is exactly the thing the
brief forbade. Most of this work went into making sure that cannot happen
again, and the two genuine defects below were found by the instrumentation
built to look for it.

One false lead is worth recording. The first sweep reported every page broken,
because the marker being searched for was the string `error-boundary` — which
appears in Next's development chunk paths on every page, working or not. The
suite now looks for the boundary's actual headline, and checks at startup that
the headline still exists in `app/(app)/error.tsx`, because an assertion
searching for text that no longer exists passes everything.

### Root-cause fixes

**`/api/service-leads` was frozen at build time.** The handler reads the
database and authenticates nobody — the roster of who leads what is
deliberately public so members can see who approves their work. With no cookie
or header read, nothing marked the route dynamic, so Next prerendered it during
`next build` and wrote the response into
`.next/server/app/api/service-leads.body`, serving that same body for the life
of the deployment. Promote someone to lead and the panel would show the old
roster until the next deploy. Every other `GET` escapes this by accident,
because authenticating happens to read a cookie. Fixed with an explicit
`dynamic = "force-dynamic"`, and `npm run smoke` now fails if any API route has
been prerendered — checked from the build output, since no request-level
assertion can see it.

**The member dashboard fired a request that could only be refused.**
`<ReviewQueue />` was mounted for everyone and treated a 403 as "nothing to
show". That reads as defensive, but it meant every member's dashboard made an
admin-only request on every load and logged a console error receiving the
refusal — noise in precisely the signal this audit depends on. The server
already knows who leads what, so the component is now mounted only for someone
who can hold a queue.

### Error visibility

A `SystemError` table, written to by the route boundary, a new global boundary
for failures in the root layout, and `/api/system-errors`. The owner reads them
at `/admin/errors`, grouped by route and message so one broken page appearing
fifty times does not bury the second, rarer failure underneath. The sidebar
badges the count of entries arriving since the owner last looked.

Two rules hold the design together. Logging an error must never cause one, so
every write is wrapped and swallowed — if the database is what broke, the
logger failing too would turn a broken page into a broken app. And none of it
is symptom-patching: the error still propagates, the boundary still shows, the
page still visibly fails. The logger only writes down what happened on the way
past.

What gets captured depends on where the failure was. A client component
crashing after hydration arrives with a real message and stack, and that class
never reaches the server log at all. A server component failing in production
arrives with only Next's digest, which is still the handle tying the row to the
server log line that has the trace.

### The smoke suite

`npm run smoke` signs in as owner, service lead and member and requests every
route, asserting HTTP 200 with no error boundary. `npm run smoke:empty` does
the same against a throwaway database with no business data — the run that
catches "this page assumes a client has a project" — building its own SQLite
file in a temp directory and never touching `prisma/dev.db`.

Two decisions matter more than the suite itself:

- **Routes are discovered by walking `/app`, not listed.** A hardcoded list
  rots: the page added next month is exactly the page nobody remembers to add
  to the test, and it would pass green while broken.
- **Expectations come from `lib/routes.ts`**, the same module the middleware
  and sidebar use. A member opening an admin route is supposed to be redirected,
  so asserting a flat 200 everywhere would either fail on correct behaviour or
  duplicate the permission map into the test to drift out of step.

`npm run smoke:browser` loads every page in headless Chrome. This exists
because the HTTP suite has a blind spot it cannot close: every page in this app
renders its real content in a client component, so a page can return flawless
HTML and still break the moment React runs. An HTTP-only suite would have
reported this entire audit green while the product was broken. It drives Chrome
over the DevTools Protocol through about 150 lines of WebSocket framing in
`scripts/cdp.mjs` rather than adding Playwright and a browser download, and
skips cleanly on a machine with no browser.

All three suites delete the accounts they create. A test that leaves
`Smoke MEMBER` behind on `/team` has quietly become a data-entry step — which
it did, once, before this was added.

### Verification

- `npm run smoke` — 67 checks, all pass
- `npm run smoke:empty` — 58 checks, all pass (9 dynamic routes skipped: an
  empty database has no client to open)
- `npm run smoke:browser` — 61 pages hydrated across three roles, all clean
- `npx tsc --noEmit` and `npx next lint` — clean
- `npm test` — 356 tests (5 added)
- `npm run build` — 59 pages, no API route prerendered
- `npm run db:reset` — fresh database to fully usable app, verified

`AUDIT.md` carries the route × role × state matrix and the known gaps: the
browser pass clicks nothing, so modals and wizards are covered only on first
render; and the matrix has not been run against Postgres.

`CLAUDE.md` now requires the stability gate at the end of every phase, and
states the two prohibitions this session was run under — never diagnose a
broken page from the browser, and never wrap a failing page in `try`/`catch` to
make it render.

### Note on `prisma migrate reset`

The exit criteria asked for `prisma migrate reset && seed`. That command cannot
run locally by design: `migration_lock.toml` is `postgresql` for deployment
while local development uses SQLite, so Prisma refuses with P3019. The
equivalent is `npm run db:reset` (`db push --force-reset` then seed), which is
what was verified and what the README documents.

---

## Production Doctrine, principle 1 — server-side data visibility

The permission matrix, enforced before data leaves the server, with a scanner
that reads every byte the server sends and fails in both directions.

### Evidence first

The matrix was not implemented from the top down. A leak scanner was built
first — sign in as each non-owner, request every page and every GET endpoint,
and search the raw response for sentinel values pulled from the database.
That produced a short, factual list instead of a guess about what might leak.

**One real leak class:** `/api/leads` returned the entire pipeline to every
signed-in person — per-stage totals, open value, average deal size, and a
figure against every lead. A Shopify designer with no sales role received the
value of every deal in the business. The board showed less than the response
carried, which is not the same as the response carrying less.

Two findings were the scanner lying, and both were fixed there rather than in
the app:

- **`3000` matched inside a cuid.** `cmskxqqc3000mvhgt…` contains a retainer
  figure flanked by letters, so three clean endpoints were reported as leaking.
  The numeric matcher excluded adjacent digits but not letters.
- **A role was assumed from an email address.** `saad@agency.local` looks like
  a member and is promoted to ADMIN by the seed as the Phase 11 backup owner,
  so his entirely legitimate access to a client record was reported as a leak.
  The scanner now reads roles from the database and skips owners by name.

### What was built

`lib/visibility.ts` is the matrix as a pure module — no Prisma, no session, no
clock — so it can be tested exhaustively rather than sampled through the UI.
`lib/viewer.ts` resolves a `Viewer` per request from the database rather than
from the session, because revoking a service lead has to take effect on the
next request rather than the next sign-in.

Two decisions worth recording:

- **Stripped fields are deleted, not nulled.** `monthlyBudget: null` still tells
  a reader the field exists, invites a component to render "—" where a number
  belongs, and leaves a leak test unable to tell "withheld" from "genuinely
  empty".
- **Pipeline totals return null rather than zeros.** A board reading "0 open" is
  a statement about the business that happens to be false.

**`isBusinessDev` is now an explicit column.** Deal visibility previously had no
concept to hang on: "Business Developer" existed only as free text in a job
title, and a permission that switches on because someone edits their title for
cosmetic reasons is not a permission.

### The crash this caused, and why that was the point

Stripping the money broke `/pipeline` for every non-owner —
`metrics.wonThisMonth.value` on an absent object. `npm run smoke:browser`
caught it; the HTTP suite could not, because the page returned a healthy 200
and failed after hydration. Making the money optional in the component's type
then made TypeScript surface three more unguarded reads that had been invisible
while the type claimed the fields were always present.

The money row is now owner-only and absent for everyone else. Stage columns,
counts and a person's own leads still render, so the page stays useful.

### Verification

- `npm run leaks` — 81 responses scanned against 17 sentinels, no owner-only
  value reached a non-owner
- `npm test` — 382 tests (26 added, every matrix row × every role, asserting
  what each role *does* receive as well as what it does not)
- `npm run smoke` 67 checks · `npm run smoke:empty` 58 · `npm run smoke:browser`
  61 pages · `tsc` and lint clean · `db:reset` verified

`npm run leaks` joins the stability gate in `CLAUDE.md`. It fails on a leak and
equally on over-restriction — a deny-everything implementation passes a
one-sided leak test while breaking the product.

### Known gaps

- **Only principle 1 is built.** Principle 2 (nothing operational requires code)
  and principle 3 (live by default) are untouched.
- **Only the leak found by evidence is fixed.** The matrix module covers client
  phone, retainer, briefs, ad KPIs, member numbers and incentive amounts, but
  the only call site rewired so far is `/api/leads` — the rest currently pass
  because those routes are admin-only, not because they are filtered. Opening
  client briefs to members, which the matrix requires, will need them.
- **The BD path is unit-tested only.** The seed's sole business developer is
  also the backup owner, so no non-owner BD exists to exercise "sees their own
  deals" end to end. The scanner reports this rather than passing quietly.

---

## Phase 12, Pillar 1 — iron-clad permissions

Server-enforced, field-level RBAC: a serializer layer, one authorization
function, and a test suite that has been proven to fail.

### The serializer layer

`/lib/serializers/` holds one serializer per entity — client, lead, user, kpi,
project, money — and its `index.ts` carries the convention as a comment at the
top of the file, where someone adding a field will actually read it: **a Prisma
row must not reach a route response or a server component's props except
through `serializeX(row, viewer)`**.

Stripped means the key is absent, never null and never masked in the browser. A
null still tells a reader the field exists, invites a component to render "—"
where a number belongs, and leaves a leak test unable to distinguish "withheld"
from "genuinely empty".

Where an entity *is* money — a payment row, an MRR snapshot — the serializer
returns null rather than an emptied object, because a chart drawn from an empty
object says the agency earned nothing.

### One authorization question

`lib/authz.ts` answers `can(viewer, action, resource)` and is what every
mutation and every admin-only section calls. It deliberately does **not**
restate the delegated-approval rules: `lib/permissions.ts` still owns who may
decide a milestone, rule on a dispute or excuse a check, because those depend
on the specific row and carry their own refusal messages. Two definitions of a
lead's authority would drift; this one delegates.

Visibility and authorization are separate modules because the answers differ. A
service lead sees every client's brief and may still not edit a client. A
member sees their own score and may never adjust it.

### The test suite, proven

`npm run permtest` does two things over a live server:

- **Forbidden keys are absent.** Every entity endpoint, as each non-owner role,
  with the JSON walked recursively for `monthlyBudget`, `paymentStatus`,
  `openValue`, bonus amounts and another member's score. Present-but-null
  fails.
- **Forbidden mutations are refused.** A member editing settings, creating a
  service, assigning service leads, approving a milestone; a lead deciding
  their own work. Sent as raw requests, because "the button is hidden" is
  precisely the defence that does not hold.

Roles come from the database, never from an email address — the seed promotes
the business developer to owner as the backup, and scanning him as a member
reports his legitimate access as a violation.

**The suite was verified by breaking the app on purpose.** A `monthlyBudget`
was injected into `/api/board`, which members do receive; permtest failed with
three findings naming the exact JSON path, and passed again when it was
reverted. A permission test that has only ever been green is not evidence.

Serializer snapshots live in `tests/serializers.test.ts` and assert the **exact
key set** per role, not a subset. Adding a column breaks a test, and fixing the
test means writing down who may see the new field — a subset assertion would
let a new column ship to everyone by being forgotten.

### Verification

`npm run permtest` 164 checks · `npm test` 405 tests (23 added) · `npm run
smoke` 67 · `npm run leaks` clean · `tsc` and lint clean.

`permtest` joins the stability gate, and `CLAUDE.md` now states that permtest
and smoke are part of the definition of done for every phase from 12 onwards.

### Scope: Pillars 2 and 3 are NOT built

This commit is Pillar 1 only. Pillar 2 (SSE live updates, optimistic UI,
production seed, de-demo sweep, first-run checklist, identity polish) and
Pillar 3 (services CRUD, the database-backed template editor, the settings
centre, team management extensions, client/project editability audit) have not
been started. They are recorded here so the gap is visible rather than
discovered later.

The one piece of Pillar 1 that remains: only `/api/leads` was rewired through
the serializers. The other routes carrying these entities are admin-gated at
the door, so they pass today because non-owners never reach them — not because
they are filtered. Opening client briefs to members, which the matrix requires,
will need them rewired first.

---

# BWM FORK — transformation begins (2 September 2026)

**Everything above this line is Agency OS history.** It is kept as the record of
how the codebase got here, not as a description of what it is becoming. Where an
entry above describes agency business logic — retainer cycles, the scoring
engine, availability checks, ROAS panels — treat it as archaeology.

## What changed in this commit

Documentation only. **No code, schema or seed has been touched yet.**

`CLAUDE.md` was rewritten for **Building Wealth Mindset (BWM)** — a
department-based CRM and internal business operating system:

- All agency business context replaced: the business, the roster, the problem,
  the solution, working hours, attendance philosophy, the Fairness & Leverage
  Doctrine and the agency permission matrix are gone.
- **Tech Stack and Design Language were preserved byte-for-byte** (verified by
  checksum). The visual design is client-approved and is law.
- Added the six-point **Core Doctrine**: design is frozen · department-aware
  everything · data-driven configuration · no demo smell · feature flags off by
  default · timezone as a company setting.
- Added the 4 departments, the 6-person roster, and the `SUPPORT_ADMIN` role.
- Recorded the inherited modules to be parked behind flags rather than deleted.

## Verified gaps — what the fork actually has to build

Checked against the current code rather than assumed:

- `Department` does not exist anywhere — no model, no constant, no relation.
- `ROLES` is `["ADMIN", "MEMBER"]` in `lib/constants.ts`; `SUPPORT_ADMIN` is new.
- `User.mustChangePassword` does not exist.
- `Settings` carries no boolean feature flags; all four parked modules need one.
- `User.jobTitle` is required and drives auto-assignment in `lib/templates.ts`;
  department membership is meant to replace that mapping.
- The old roster and demo data (5 users, 5 clients, 4 projects, 10 leads) live in
  `prisma/seed.ts` and must go.
- Timezone is hardcoded `Asia/Karachi` in `lib/date.ts`; it becomes a company
  setting defaulting to `America/New_York`.

## Carried forward from the fork

The stability gate (`smoke`, `smoke:empty`, `permtest`, `leaks`, `tsc`, `test`),
the empty-state rule, and server-side enforcement of data visibility all survive
the fork — but the scripts were written against agency roles and fixtures. Until
they are re-pointed at departments and the new roster, **a green run does not
mean what it used to.**

## Deliberately unspecified

Field-level visibility *within* a department. The inherited matrix made money
fields owner-only, but BWM's departments are sales-driven and members may need
to see their own deal values. Left as an open question for the client rather
than guessed at.

---

## BWM Phase 1 — foundation: departments, roles, seed (2 September 2026)

Schema and seed only. **No UI was added or changed** — the design is frozen, and
nothing in this phase renders anything new.

### Schema

- **`Department`** — slug, name, description, sortOrder, isActive. Four seeded;
  nothing in code assumes that number or those names.
- **`DepartmentMember`** — the team-department-skill mapping, with an optional
  free-text `skill`. Unique on `(userId, departmentId)`.
- **`PipelineStage`** — per-department funnel stages, with `isWon` / `isLost`
  flags so the app reads terminal state instead of string-matching "WON".
- **`ClientFieldDef`** / **`ClientFieldValue`** — per-department custom client
  fields. Values are stored as text so retyping a field is not a migration.
- **`Client.departmentId`** and **`Lead.departmentId`** are **required**, with
  indexes on `(departmentId, status)` and `(departmentId, stage)`.
- **`User.mustChangePassword`**.
- **`Settings.timezone`** (default `America/New_York`) and four parked-module
  flags, all `false`.

### Roles

`ROLES` becomes `["ADMIN", "SUPPORT_ADMIN", "MEMBER"]` with
`hasAdminPower()` in `lib/constants.ts` as the single authority check. 33 files
were moved off bare `role === "ADMIN"` comparisons. The two role *mappers*
(`lib/viewer.ts`, `lib/permissions-service.ts`) collapse SUPPORT_ADMIN into the
existing owner tier, so everything reading a mapped Viewer/Actor inherited the
change without edits. UI labels SUPPORT_ADMIN as "Support"; existing "Owner" and
"Member" wording is untouched.

### Seed

`prisma/seed.ts` rewritten: 4 departments, 21 pipeline stages, 10 client fields,
6 users, `mustChangePassword` on all of them, and **zero demo business data**.
The agency seed is preserved as `prisma/seed.agency.archive` (a non-`.ts`
extension so it stays out of the build).

### Two real bugs found and fixed

- **The gate scripts treated SUPPORT_ADMIN as a non-owner.** `permtest` and
  `leak-scan` filtered owners with `role === "ADMIN"`, so every legitimate admin
  payload reaching Raja Zain would have been reported as a leak. They also
  hardcoded the old `member123` password. Both fixed; they now read
  `SEED_PASSWORD` and share an `isAdminRole` helper.

- **`.env.production.local` broke every production run.** Created during the
  earlier deploy prep with `REPLACE_ME` placeholders. Next.js auto-loads that
  filename during `next start`, where it overrode `.env` and pointed the server
  at `postgresql://REPLACE_ME`. Every login returned a bare 401 with nothing in
  the log, because NextAuth swallows the Prisma connect error and reports it as
  a rejected credential. Renamed to `.env.vercel.local`, which Next does not
  load and `.gitignore` still covers. `DEPLOY.md` records why.

### Stability gate — all six green

```
npm run smoke        ✓ every route rendered for every role (58 checks)
npm run smoke:empty  ✓ every route rendered for every role
npm run permtest     ✓ no forbidden field or mutation reached a non-owner (171 checks)
npm run leaks        ✓ no owner-only value reached a non-owner (104 responses)
npx tsc --noEmit     ✓ clean
npm test             ✓ 405/405
```

`permtest` and `leaks` now correctly skip two owners — `coachd@bwm.local` and
`rajazain@bwm.local`. The `/clients/[id]`, `/projects/[id]` and `/reports/[id]`
skips are correct: there is no demo data to open, which is the point.

### What this phase deliberately did NOT do

Department scoping is **declared, not enforced** — the columns exist, but no
query filters by them yet, so a MEMBER still sees every department. Likewise
`mustChangePassword` is stored but not enforced, the parked-module flags are
stored but not read, and `lib/date.ts` still hardcodes `Asia/Karachi`. These are
listed under *Fork status* in `CLAUDE.md`. Nothing here should be mistaken for
Doctrine 2 or Doctrine 5 being satisfied.

---

## BWM Phase T1 — identity, departments and the new team (3 September 2026)

Design untouched. Every screen added here is composed from existing components,
and the frozen Tech Stack / Design Language block in `CLAUDE.md` still matches
its original checksum (`ec6e2dc0…`).

### 1. Rebrand sweep

Zero references to the old agency name or roster survive in code. Swept: app
metadata and title template, PWA manifest (name, short_name, description, and
its home-screen shortcuts, which pointed into the now-parked attendance
module), `package.json` + `package-lock.json` name, sidebar and mobile
wordmarks, service-worker cache version and notification tag, email templates,
report footers, activity-feed system actor, `tailwind.config.ts`, and every
test fixture.

The **login page keeps its exact layout** — same dark editorial panel, same
classes. Only text changed: the wordmark, the three-line headline, the business
lines replacing the old service list, and the demo-credentials block, which was
printing `subtain@agency.local / member123` in plain text and is now a note
that seeded accounts must change their password.

### 2. Department foundation

- `Department` gains `shortLabel`, `colorToken` and `order`.
- `DepartmentMember` becomes **`DepartmentMembership`** with `roleInDept`
  (LEAD | MEMBER) and `skills`.
- Seeded exactly to the roster matrix — 17 memberships: Coach D in all 4,
  Tayyaba 2, Claire 3, Cam 3, Cheryl 1, Raja Zain 4 (support access).
- Per-member, per-department skills seeded from responsibilities
  (Coach D: sales/dispatch/closing…, Cam in Affiliates: affiliates/referrals/
  commissions, and so on).
- **Settings → Departments**: create, edit, reorder, deactivate; per-department
  team and skill editing. Deactivating a department that still owns clients or
  leads is **refused with a 409 unless an explicit destination is chosen**, and
  the records are moved in a transaction — a department-scoped query returning
  nothing with no explanation is worse than a blocked toggle.
- Ordering is arrow-driven rather than pointer-drag: it is edited rarely, and a
  keyboard-reachable control that works on a phone beats a drag handle needing
  a mouse plus a fallback. The whole ordered list is sent, so the server never
  infers what moved.

### 3. Team replacement

- **Forced password change.** `mustChangePassword` is now enforced in the app
  shell before any surface renders, redirecting to `/change-password` — a page
  deliberately outside the `(app)` group, since one inside it would redirect to
  itself forever. The flag is read from the database, not the session token, so
  a stale token can neither bypass nor re-trigger the gate. The current password
  is required even on the forced change: the account is reachable by anyone
  holding the shared placeholder.
- **Team roster** replaces the legacy "Job title" column with **Departments** —
  badges plus the union of that person's skills, clickable to edit inline. Same
  column count, so the table layout is unchanged.
- `SUPPORT_ADMIN` reaches every admin route and renders as **"Support"**.

### 4. Parked modules

`lib/modules.ts` is one registry owning every surface a module reaches: nav
keys, route prefixes, API prefixes and jobs. With a flag off the module is
**absent**, not empty:

- nav entries filtered server-side (never in the client rail, so a parked
  module cannot flicker into view while a fetch resolves)
- **dashboard cards gated per module** — attendance card, at-risk milestones,
  leaderboard, MRR/collections/ROAS, member deadlines, and the stat cards for
  open milestones, on-time rate, team score and presence
- the Activity card's "Open the board" link removed with the module
- the evaluate cron returns `{status: "skipped"}` when all three of its modules
  are off
- routes answer with a `ModuleDisabled` screen built from `EmptyState`

The rail after this phase is exactly: **Dashboard · Pipeline · Clients · Tasks ·
Team · Reports · Settings**. Audit and error logs moved under Settings as tabs
— still role-gated, because they stay in `NAV_ITEMS` marked `hidden`, which is
what grants them that guard.

### Bugs found and fixed

- **`NAV_ITEMS` had no `SUPPORT_ADMIN`.** Raja Zain would have seen an *empty
  sidebar*. Worse, `ADMIN_ONLY` was derived from `roles.length === 1`, so simply
  adding the role would have silently stripped admin protection from every
  admin route. Now derived from the absence of `MEMBER`.
- **Smoke's new module assertion immediately caught a real Doctrine 5
  violation**: the dashboard still linked `/board` with retainer projects off,
  and in fact read no module flags at all — so every parked module's cards were
  still rendering.
- **The password gate broke the harnesses.** Every seeded account has the flag
  set, so permtest and leaks would have received the change-password screen for
  every route — passing a leak scan perfectly while checking nothing. Both now
  clear the flag for accounts under test, with a comment saying why.
- **My own rebrand sweep broke 3 tests.** It renamed fixtures but missed an
  assertion whose regex escaped the dot (`agency\.local` never matched
  `agency.local`), flipped a sorted expectation when `shahnawaz`→`claire`
  changed alphabetical position, and over-reached onto "Ayesha"/"Bilal" — generic
  mention-parser fixtures that were never agency roster names. All three fixed.

### Stability gate — all six green

```
npm run smoke        ✓ every route rendered for every role (82 checks)
                     ✓ 4 parked modules verified absent
npm run smoke:empty  ✓ every route rendered for every role
npm run permtest     ✓ no forbidden field reached a non-owner (171 checks)
npm run leaks        ✓ no owner-only value reached a non-owner (104 responses)
npx tsc --noEmit     ✓ clean
npm test             ✓ 405/405
```

### Walkthrough

As **Coach D**: forced to change password, then the rail shows all seven items.
As **Cheryl**: forced to change password, then Dashboard · Pipeline · Tasks
(admin-only entries correctly absent). Both: zero parked-module links anywhere
on the page, zero stale agency strings. As **Raja Zain**: reaches every admin
route, labelled "Support".

### Deviation from spec

`skills` is a comma-separated `String`, not `String[]`. Prisma has no array
column on SQLite and `CLAUDE.md` forbids array columns to keep the schema
Postgres-portable. `lib/skills.ts` owns parse/serialize; the API and UI both
work in `string[]`, so only the storage differs.

### Not done — do not mistake this for Doctrine 2 being satisfied

Department **scoping is still not enforced**. The columns, the memberships and
`departmentIdsForUser()` all exist, but no list or detail query filters by
department, so a MEMBER still sees every department's records. Also outstanding:
`lib/date.ts` still hardcodes `Asia/Karachi` despite `Settings.timezone`, and
the dynamic field engine (`ClientFieldDef`) is seeded but read by nothing.

## BWM Phase T2 — the department field engine (9 September 2026)

Design untouched. Every screen here is composed from existing primitives —
`Input`, `Textarea`, `Select`, `Card`, `Badge`, `Avatar`, `Tabs`, `Modal`,
`EmptyState`, `Skeleton` — and the MULTISELECT control is the same pill toggle
the lead form already used for services. No new colour, type or component.

### 1. The engine

`lib/fields.ts` owns everything about department-specific storage: options
parsing, the text encoding of each type, validation, conditional visibility, and
the read/write of `FieldValue`. Nothing downstream splits a stored string by
hand.

Two shapes follow from the Postgres-portable-SQLite rule, and match how
`skills` already works: `options` is comma-separated text, and `FieldValue.value`
is text whatever the declared type. A Json column would be the obvious
alternative and SQLite has none — text plus a typed accessor also means changing
a field from TEXT to SELECT is not a column migration.

Three decisions worth recording:

- **An unresolvable condition hides its field.** A rule pointing at a missing or
  inactive field returns *not visible*, never *visible*. A condition that cannot
  be evaluated has not been met, and defaulting the other way would leak exactly
  the questions the rule was written to hide.
- **A hidden field's answer is discarded on write.** Leaving the insurance
  answers on a record whose category moved to "Cam" would show them again the
  moment it moved back, as data nobody entered for that state.
- **Required is only checked on visible fields.** A required insurance question
  on a Cam sale is not a missing answer; it is a question that was never asked.

### 2. Seed

17 definitions per department across the four business lines, seeded for **both**
entities — 34 rows. The spec's lists include the common core (name, contact,
phone, email, status, assignee, follow-up, notes); those stay real columns on
`Lead`/`Client`, and only the department-specific remainder became definitions.

Culture Plus carries the conditional pair: `insurance_info` appears only when
`sales_category` is Life or Health Insurance, `cam_info` only when it is Cam.

### 3. Creation flow

`LeadFormModal` is now three steps — department, details, stage & owner. The
department is asked first because it decides the rest of the form: which
questions are asked, which stages exist, and who may be assigned.

`AssigneePicker` is a radio group rather than a `<select>`, because a native
select cannot carry the two things that make the decision well — why someone is
recommended, and what they are already carrying. Ranking is a hint, never a
filter: every member of the department stays selectable.

Skill matching is **whole-word, not substring**. Substring was the obvious first
cut and is wrong: "Cam" is a substring of "campaign", and Culture Plus's Cam
category matching a campaign skill is precisely the conflation CLAUDE.md calls
out by name.

### 4. Admin UI

Settings → Departments → **Fields**, beside the existing Team button and built on
the same whole-list-replace endpoint: the order of the rows is the display order,
and the whole set is sent so two admins converge on a list. An existing field
keeps its key when relabelled — rewriting it would orphan every answer already
recorded against it.

### Bugs found and fixed

- **`POST /api/leads` hardcoded `stage: "NEW"`.** Stages are per-department
  records; Affiliates opens at `APPLIED`. Every Affiliates lead was being filed
  into a stage that department does not have, where no column on its board would
  ever render it. The opening stage now comes from the department's own pipeline.
- **The lead form never sent `departmentId`,** which T1 made required — so
  creating a lead from the UI failed with a 422 every time.
- **Deleting a lead or client orphaned its answers.** `FieldValue.recordId` is
  deliberately not a foreign key, so no cascade reaches it; both delete paths now
  clear values explicitly.
- **`npm run smoke:browser` had not parsed since T1.** The rebrand sweep inserted
  a comment block *inside* an import statement, splitting `import {` from its
  member list. The one check that catches a client component crashing after
  hydration has been dead for the whole fork, and the six-command gate never
  noticed because it is the optional seventh. Repaired; it now runs green.

### Stability gate

```
npx tsc --noEmit     ✓ clean
npm test             ✓ 405/405
npm run smoke        ✓ every route × every role
npm run smoke:empty  ✓ every route × every role
npm run permtest     ✓ 171 checks
npm run leaks        ✓ 108 responses, 0 sentinels
npm run fieldtest    ✓ 45 checks  (new — see below)
npm run smoke:browser ✓ 66 pages hydrated across 3 roles
```

`scripts/fieldtest.mjs` is new, and checks over HTTP what this phase actually
claims — because all three claims are claims about a *response*, not about a
component:

- each department's form offers only its own fields, and its assignee list is
  exactly its own membership
- a lead created in each of the four opens at one of that department's own
  stages, with its answers bound to that department's definitions
- Tayyaba is offered exactly her two departments, and Affiliates and Culture Plus
  answer **403** to both the form read and the create — absent from the picker is
  not the same as refused by the server, and only the second is a permission

### Not done

- **`ClientWizard` is still department-last.** Client creation was not converted
  to the department-first wizard; leads were. The client *profile* and list are
  done.
- **The clients list is still `requireAdminApi`.** Its rows and its department
  chips are both derived from `departmentIdsForUser`, so widening the gate scopes
  them together — but widening it is a permissions change belonging with the
  Doctrine 2 enforcement work, not something to fold into this phase quietly.
- **Department scoping is still not enforced on the pipeline or lead reads.**
  Creation is scoped, end to end and tested. Reading is not.

## BWM Phase T3, part 1 — department pipelines (9 September 2026)

**Section 1 of three.** Tasks & follow-ups (§2) and the activity timeline UI
(§3) are **not built** — see *Not done* at the end. Recorded as a partial phase
rather than claimed as a whole one.

Design untouched: the board is the same kanban, the same `DropColumn`,
`LeadCard`, `StatCard`, `Table` and pill chips. What changed is where the
columns come from.

### Stages became data

`PipelineStage` gained `kind` (OPEN | WON | LOST | ACTIVE_CLIENT) and
`colorToken`, and lost `isWon`/`isLost` — extending the existing model rather
than adding the spec's `StageDefinition` beside it, which would have left two
stage tables and two sources of truth.

The pair had to go, not just be supplemented. Two booleans can express "won and
lost at once", which is not a state a deal can be in, and they left nowhere to
put the stages that come *after* a win — Insurance's Active Client is neither
the win nor a step towards it.

Seeded to the T3 lists: 29 stages across four departments.

### Deviation: Pilot Cars keeps a Lost stage

The T3 list for Pilot Cars has no Lost, while saying "add Lost" for two of the
other three. Read as the same omission rather than an intent — and without it a
dead inquiry has nowhere to go, which is how a board silently fills with stale
cards. Kept, and flagged here rather than done quietly. It is one row in an
admin-editable table if that reading is wrong.

### Moving a card

`lib/stages.ts` owns every rule a move implies, so a drag, the drawer and a
script cannot diverge: the target must belong to *this lead's* department, a
LOST stage requires a reason, a winning stage flips `convertedAt` and notifies
the assignee and every admin except whoever just did it, and the move logs its
own `STATUS_CHANGE` activity.

Commission is **derived, never stored**: rate lives in the department's
`commission_rate` field definition and the deal value can be corrected after the
fact, so a stored amount would silently disagree with both and nothing would say
which was right. A department with no such field gets no table — a data
question, not a hardcoded one.

### Bugs found and fixed

- **`logActivity` auto-advanced stages from a hardcoded map.** `IMPLIED_STAGE`
  moved a deal to MEETING_BOOKED or PROPOSAL_SENT — keys **no BWM department
  has**. Logging a meeting would have written a stage no column could render,
  putting the card nowhere. Logging what happened and deciding where the deal
  has got to are now separate acts.
- **`LeadCard` rendered money unguarded** while the server was already stripping
  it. The type claimed `estimatedMonthlyValue` was always present; it is absent
  for non-owners, so `formatMoney(undefined)` was one non-owner away from
  throwing. Adding `dealValue` behind the same guard rather than beside it.
- **The board would have shown nothing.** Changing the stage keys orphaned every
  card against the old `OPEN_STAGES` columns. The rework repairs that, and an
  "Not on the board" lane now surfaces any lead whose stage a department has
  since removed, rather than dropping it silently.

### Stability gate

```
npx tsc --noEmit      ✓ clean
npm test              ✓ 405/405
npm run smoke         ✓ every route × every role
npm run smoke:empty   ✓ every route × every role
npm run permtest      ✓ 171 checks
npm run leaks         ✓ no owner-only value reached a non-owner
npm run fieldtest     ✓ 45 checks
npm run journeytest   ✓ 58 checks  (new)
npm run smoke:browser ✓ 66 pages hydrated across 3 roles
```

`scripts/journeytest.mjs` drives T3's exit criteria over HTTP — the journeys,
not the screens: Pilot Cars inquiry → Completed carrying a quote, Insurance →
Converted → Active Client, Affiliate → Active with commission computed from
12,000 × 12.5% = 1,500, Culture Plus → Won. It also asserts each move was
logged, that `convertedAt` flipped, that LOST is refused without a reason
whatever the department calls that stage, and that a non-member's request for
another department's board answers 403.

### Not done — §2 and §3

- **Tasks and follow-ups.** The `Task` model exists (deliberately not
  `Milestone`, which is retainer delivery inside a parked module). Nothing reads
  it: no `/tasks` sections, no filters, no snooze, no 9am follow-up
  notification, no dashboard count.
- **The activity timeline UI.** `SalesActivity` now carries `departmentId`, an
  optional `clientId` and `isSystem`, and stage moves auto-log through it — so
  the data is accumulating correctly. The quick-log bar and the filterable
  timeline are not built.
- **Two nullable foreign keys, not `recordId`.** T3 specifies a polymorphic
  `recordId` on both Activity and Task. There are only two possible targets and
  both are known at write time, so real foreign keys keep the cascade and refuse
  orphans. `FieldValue` gives that up only because its target table is chosen by
  another column, which Prisma cannot express.
