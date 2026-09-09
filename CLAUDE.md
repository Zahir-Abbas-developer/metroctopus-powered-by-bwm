# Building Wealth Mindset (BWM)

A department-based CRM and internal business operating system.

Forked from an agency OS codebase. **All previous agency branding, roster and
business logic are being replaced.** Where this file and the code disagree, this
file is the intent and the code is the backlog — but see *Design is frozen*
below, which is the one place the existing code outranks any new idea.

## Core Doctrine

Six rules. They outrank everything else in this file and every convention
inherited from the fork.

### 1. Design is frozen

The existing layout, sidebar, header, cards, tables, forms, colours,
typography, components, navigation, responsiveness and animations are
**client-approved and are law**. New features are composed from **existing
components in the existing style**.

Redesigning anything is a defect. If a feature seems to need a new visual
pattern, the answer is almost always an existing component used differently —
and if it genuinely is not, that is a question for the client, not a decision to
make while building.

### 2. Department-aware everything

Every lead, client, deal, task, activity and metric **belongs to exactly one
department**. Views, dropdowns, dashboards and permissions respect department
membership. A user sees their departments; an admin sees all of them.

There is no such thing as a department-less record. A query that forgets to
scope by department is a data-leak bug, not a display bug.

### 3. Data-driven configuration

Departments, their client field definitions, their pipeline stages, and
team-department-skill mappings are **database records editable by admins in
Settings — never hardcoded**.

**BWM's requirements are the SEED, not the code.** The four departments below
are seed data. Nothing in a component, a constant or a type may assume there are
four of them, or that they are named what they are named today.

### 4. No demo smell

Every number on every screen derives from a real database query. No hardcoded
stats, no fake buttons, no placeholder functionality. **Full CRUD or it doesn't
ship.**

### 5. Feature flags for everything BWM did not ask for

Inherited modules BWM did not request are gated behind Settings feature flags,
**all OFF by default** — see *Parked modules* below. When a flag is off the
feature **fully disappears**: no nav item, no dashboard card, no cron job, no
orphan heading, no empty page, no error. **Do not delete their code.**

### 6. Timezone is a company setting

BWM is US-based. App timezone is a **Company setting, default
`America/New_York`**, and it drives all due dates and all "today" logic. It is
not a constant and it is not the server's locale.

## The Business

BWM operates multiple business lines under one roof. The CRM manages leads,
clients, deals, tasks, follow-ups and team performance across **4 departments**:

| # | Department | Covers |
| --- | --- | --- |
| 1 | **BWM — Pilot Cars Sales & Dispatch** | Sales, quotes, dispatch coordination, scheduling, job management |
| 2 | **BWM — Life & Health Insurance** | Insurance leads, qualification, policies, conversion |
| 3 | **BWM — Affiliates** | Partner onboarding, referral tracking, commission tracking |
| 4 | **Culture Plus Network** | Sales, Cam, Life & Health Insurance |

> In department 4, **"Cam" is a sales/service category, not the team member.**
> Cam the person is on the roster below and is not a member of Culture Plus
> Network. Do not conflate them anywhere — not in a seed, a label, a filter or a
> report.

Departments differ in what they track. Pilot Cars carries dispatch and
scheduling; Insurance carries policies and qualification; Affiliates carries
referrals and commission. That variation is expressed as **per-department client
field definitions and pipeline stages held in the database** (Doctrine 3), not
as four hardcoded shapes.

## The team

These six are the **only** users. The previous agency roster is fully removed.

| Name | Role | Departments |
| --- | --- | --- |
| **Coach D** | ADMIN | All 4 |
| **Tayyaba** | MEMBER | Pilot Cars · Life & Health Insurance |
| **Claire** | MEMBER | Pilot Cars · Life & Health Insurance · Culture Plus Network |
| **Cam** | MEMBER | Pilot Cars · Life & Health Insurance · Affiliates |
| **Cheryl** | MEMBER | Culture Plus Network |
| **Raja Zain** | SUPPORT_ADMIN | System maintainer — full admin capability, labelled **"Support"** in the UI |

Seed emails follow a placeholder pattern — `coachd@bwm.local`, `tayyaba@bwm.local`,
and so on — and every seeded account carries **`mustChangePassword = true`**, so
the first real login forces a password change. Placeholder credentials must never
survive first contact with a real user.

## Roles

- **ADMIN** — Coach D. Sees and manages everything across all departments.
- **SUPPORT_ADMIN** — Raja Zain. Identical capability to ADMIN; differs only in
  that the UI labels it **"Support"**. It exists so the maintainer is
  distinguishable from the business owner in audit logs and user lists.
- **MEMBER** — scoped to the departments they belong to. Sees leads, clients,
  deals, tasks and metrics for those departments only.

## Tech Stack

Fixed — do not change without asking.

- Next.js 14+ (App Router) + TypeScript
- Tailwind CSS
- Prisma ORM with SQLite for development (schema must remain **Postgres-compatible** for later deployment)
- NextAuth (credentials provider) for authentication
- Deployed later to Vercel + a managed Postgres (Neon/Supabase)

## Design Language

Fixed — this is the product's identity.

### Fonts

- `Syne` — display/headings, weights 600–800 (Google Fonts)
- `DM Sans` — body (Google Fonts)

### Palette

| Token | Hex |
| --- | --- |
| Near-black | `#0C0C0A` |
| Warm white | `#FAFAF7` |
| Cream | `#F5F2EB` |
| Primary green | `#1A6B3A` |
| Green light tint | `#E8F5EE` |
| Amber (warning) | `#C4730A` |
| Amber tint | `#FEF3DC` |
| Red (danger) | `#C0392B` |
| Red tint | `#FDECEA` |
| Blue (info) | `#1A4FA0` |
| Blue tint | `#E8EEFF` |
| Borders | `#E2E0D8` |

### Style

- Editorial and premium — **not** generic SaaS
- Dark hero/header areas with subtle radial green glows
- Uppercase, letter-spaced eyebrow labels
- Generous whitespace
- 1px borders instead of heavy shadows
- Rounded pill badges for statuses

Every screen must look intentionally designed, like a product from a world-class design studio.

## Parked modules (feature-flagged OFF)

These came from the agency fork. BWM did not request them. Each is gated behind
a Settings feature flag, **default off**:

| Module | What it was | Flag covers |
| --- | --- | --- |
| **Attendance & availability checks** | Random hidden availability pings, clock-in, breaks, leave, outages | Nav items, attendance board, member attendance panels, the check-scheduling cron |
| **Performance scoring engine** | 100-points-per-month `ScoreEvent` ledger, disputes, incentives, leaderboard | Scoring nav, score columns, dispute UI, incentive awards, the nightly evaluate cron |
| **Monthly retainer project cycles** | Auto-renewing modules/milestones per retainer client | Cycle generation, renewal cron, milestone auto-assignment |
| **Client KPI / ROAS panels** | Ad spend, revenue, ROAS, MRR snapshots | Client KPI tabs, money dashboard cards, the reports that aggregate them |

Rules for all four:

- **Off is invisible, not empty.** No nav entry, no dashboard card, no route
  reachable, no cron firing. A flag that leaves a heading over a blank panel has
  not been implemented.
- **Off must not error.** A disabled module's routes return a clean not-found or
  redirect — never a crash, never a page that 200s and then dies on hydration.
- **Do not delete the code.** These may be switched on later. Removing them
  turns a config change into a rebuild.
- **The crons in `vercel.json` are part of the flag.** A background job that
  keeps running for a disabled module is the same bug as a visible nav item.

## Configuration lives in the database

Departments, client field definitions, pipeline stages, team-department-skill
mappings, the company timezone and the feature flags above are **admin-editable
records**. Changing how BWM runs must never require a developer, a deploy, or an
edit to a constant in a file.

The seed establishes BWM's current shape. It does not establish the schema's
limits.

## Access is enforced server-side

Department scoping and role-based field stripping happen in a **central
serialization layer, before data leaves the server**. Hiding a component is
never sufficient — a hidden component still shipped the value to the browser,
where it sits in the RSC payload for anyone who opens the network tab.

The baseline rule: **ADMIN and SUPPORT_ADMIN see all departments; a MEMBER sees
only the departments they belong to**, for every entity — leads, clients, deals,
tasks, activities and every metric derived from them.

> **Open question, to settle with the client before building:** the inherited
> matrix made money fields (deal values, budgets, payment status) owner-only.
> BWM's departments are sales-driven and members may well need to see the value
> of their own deals. Field-level visibility *within* a department is
> deliberately unspecified here rather than guessed at.

## Conventions

- Keep components small and reusable in `/components` — and prefer composing
  what is already there (Doctrine 1) over adding to it.
- All dates go through the single date utility, resolved against the **company
  timezone setting** (Doctrine 6). No `new Date()` arithmetic in a component.
- Department scoping belongs in the query layer, not in a `.filter()` on the
  page.
- After completing any significant feature, append a summary to `PROGRESS.md`.

## Stability gate — run at the end of every phase

Any phase that touches a page, a query, a route or the schema ends by running:

```bash
npm run smoke          # every route × every role, against the current database
npm run smoke:empty    # the same, against a database with no business data
npm run permtest       # forbidden fields absent, forbidden mutations refused
npm run leaks          # cross-department values must not reach a non-member
npx tsc --noEmit
npm test
```

All six must be clean before the phase is committed. `npm run leaks` reads every
byte the server sends to each role and fails on a value the access rules forbid
— and fails just as loudly when a role stops receiving something it should get,
because a deny-everything implementation passes a one-sided leak test while
breaking the product. `npm run smoke:browser` additionally loads every page in a
real browser and is the only check that catches a client component crashing
after hydration — run it when a phase changed anything a page renders.

**These scripts were written against the agency's roles and fixtures.** Part of
the fork is re-pointing them at departments and the new roster; until that is
done, a green run does not mean what it used to.

### Why this exists

The agency build produced pages that returned a healthy HTTP 200 and then failed
in the browser, and nobody found out until someone mentioned it in chat. Two
rules follow:

- **Never diagnose a broken page from the browser.** Get the server-side error
  and stack trace, or reproduce it under `npm run smoke:browser`. A guess that
  fixes the symptom leaves the cause in place.
- **Never wrap a failing page in `try`/`catch` to make it render.** Hiding an
  error deletes the evidence and converts a loud bug into a silent one. Fix the
  query, add the null handling, or render an `EmptyState`.

### Empty states are a feature, not a fallback

Every query result must have a designed empty state. A department with no leads,
a member with no tasks, a new client with no deals — these are normal states of a
real business, not edge cases. Use `EmptyState`; never render a blank `div`, and
never let missing data reach a `.map` or a property access.

Note the tension with Doctrine 4: an empty state is not demo smell. **A designed
"no leads yet" is correct; a hardcoded "12 leads" is not.**

### Errors are recorded, not just thrown

Error boundaries report to `/api/system-errors`, and an admin reads them at
`/admin/errors` with an unseen count badged in the sidebar. When adding a new
boundary or background job, log failures there too.

## Fork status

**Done — Phase 1 (foundation), Phase T1 (identity, departments, team) and
Phase T2 (the department field engine).** Verified by the stability gate, not
assumed:

- **Branding.** Zero references to the old agency name or roster survive in
  code, tests, metadata, the PWA manifest or the package name. The login page
  keeps its exact layout; only its text changed.
- **Departments.** `Department` (slug, name, shortLabel, colorToken, order,
  isActive), `DepartmentMembership` (roleInDept, skills), `PipelineStage`,
  `FieldDefinition` (entity, key, type, options, required, order, conditional
  visibility), `FieldValue`. `Client` and `Lead` carry a required
  `departmentId`.
- **Roles.** `["ADMIN", "SUPPORT_ADMIN", "MEMBER"]`, with `hasAdminPower()` as
  the only authority check. SUPPORT_ADMIN reaches everything ADMIN does and
  renders as "Support".
- **Seed.** 4 departments, 21 pipeline stages, 34 field definitions (17 per
  department set, seeded for both LEAD and CLIENT), 6 users, 17 memberships with
  per-department skills, and **no demo business data**.
- **Forced password change.** `mustChangePassword` is enforced in the app shell
  before any surface renders, and lifts once satisfied.
- **Parked modules.** Attendance, scoring, retainer projects and client KPIs are
  off by default and genuinely absent: no nav entry, no dashboard card, no link,
  no cron run. Their routes answer with a disabled screen. Smoke asserts it.
- **Admin UI.** Settings → Departments (CRUD, reorder, per-department team and
  skills, deactivation with a required migration choice), Settings → Departments
  → Fields, and Settings → Modules.
- **The field engine.** `lib/fields.ts` owns options, validation, conditional
  visibility and value storage. Lead creation is department-first: the chosen
  business line decides the questions asked, the opening stage, and who may be
  assigned. `npm run fieldtest` checks all of that over HTTP.

**Still to build.** None of this is done:

- **Department scoping is enforced on creation only.** T2 scoped the creation
  path end to end — the picker, the form route and the write all refuse a
  department the viewer is not in, and `npm run fieldtest` proves it. Reading is
  still open: no pipeline or lead list query filters by department, so a MEMBER
  still *sees* every department's records. Doctrine 2 is now half a guarantee.
- **Timezone.** `Settings.timezone` exists and defaults to `America/New_York`,
  but `lib/date.ts` still hardcodes `Asia/Karachi`. Every "today" and due-date
  calculation is still on the wrong clock.
- **`User.jobTitle`** is still required and still drives auto-assignment in
  `lib/templates.ts`. Department membership is meant to replace it.
- **`ServiceCatalog`, `ServiceLead` and the SERVICE_LEAD visibility tier** are
  inherited agency concepts with no BWM meaning. Left in place deliberately;
  they need a decision rather than a deletion.

## Known deviations from spec

Recorded so the next person does not read them as oversights:

- **`skills` is a comma-separated `String`, not `String[]`.** Prisma has no
  array column on SQLite and this file forbids array columns to keep the schema
  Postgres-portable. `lib/skills.ts` owns the parsing, and the API and UI both
  work in `string[]`.
- **A disabled module's route answers 200 with a disabled screen, not a 404.**
  A real 404 renders the generic not-found page, which cannot say the one useful
  thing — that the feature exists, is switched off, and who can switch it on.
