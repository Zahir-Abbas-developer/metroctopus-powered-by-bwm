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
