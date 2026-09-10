# Route audit

Every page, every role, both data states. Generated during the stabilisation
pass and kept current by `npm run smoke`.

## How this was checked

Not from the browser address bar. Three passes, each catching what the previous
one cannot:

| Pass | Command | Catches |
| --- | --- | --- |
| HTTP, current database | `npm run smoke` | Server component failures, wrong redirects, authorisation holes |
| HTTP, empty database | `npm run smoke:empty` | Pages that assume a client has a project, a member has score events, a month has KPI entries |
| Real browser | `npm run smoke:browser` | Client component crashes after hydration — invisible to both passes above |

The third pass matters more than it looks. Every page in this app renders its
real content in a client component, so a page can return a flawless HTTP 200
with healthy HTML and still show the error boundary the moment React runs. An
HTTP-only suite would have reported this entire audit green while the product
was broken.

Roles are the three that exist in practice: `ADMIN` (the owner), `SERVICE_LEAD`
(a member who leads at least one service line — not a database role, but a
distinct authority path), and `MEMBER`.

### Result of the last full run

| Pass | Checks | Result |
| --- | --- | --- |
| HTTP, current database | 67 | all pass |
| HTTP, empty database | 58 (+9 skipped, nothing to open) | all pass |
| Real browser | 61 pages hydrated | all pass |
| `npx tsc --noEmit` | — | clean |
| `npm test` | 356 | all pass |
| `npm run build` | 59 pages | no API route prerendered |

Each suite creates three accounts to sign in with and deletes them again when
it finishes. A test that leaves `Smoke MEMBER` behind on `/team` has quietly
become a data-entry step.

## What "PASS" means per cell

- **Allowed** — HTTP 200, no error boundary, no uncaught exception in the browser.
- **Refused** — a redirect away from the route. Being turned away is correct
  behaviour and is asserted as such; a 200 where a redirect belongs is a
  failure, not a pass.
- **n/a (empty)** — a dynamic route with nothing in the database to open. An
  empty database has no client to visit. Recorded as skipped, never as passed.

## The matrix

22 routes discovered by walking `/app`. `/login` is excluded from the role
matrix (it is the unauthenticated route); `/` is asserted separately as a
redirect to `/dashboard`.

| Route | ADMIN | SERVICE_LEAD | MEMBER | Empty DB |
| --- | --- | --- | --- | --- |
| `/` | PASS (→ /dashboard) | PASS (→ /dashboard) | PASS (→ /dashboard) | PASS |
| `/dashboard` | PASS | PASS | PASS | PASS |
| `/board` | PASS | PASS | PASS | PASS |
| `/pipeline` | PASS | PASS | PASS | PASS |
| `/clients` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/clients/[id]` | PASS | PASS (refused) | PASS (refused) | n/a (empty) |
| `/projects` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/projects/[id]` | PASS | PASS (refused) | PASS (refused) | n/a (empty) |
| `/my-tasks` | PASS | PASS | PASS | PASS |
| `/my-attendance` | PASS | PASS | PASS | PASS |
| `/attendance` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/my-performance` | PASS | PASS | PASS | PASS |
| `/my-reports` | PASS | PASS | PASS | PASS |
| `/reports` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/reports/[id]` | PASS | PASS (refused — not theirs) | PASS (refused — not theirs) | n/a (empty) |
| `/disputes` | PASS | PASS | PASS | PASS |
| `/incentives` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/team` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/team/[id]` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/scoring` | PASS | PASS | PASS | PASS |
| `/admin/audit` | PASS | PASS (refused) | PASS (refused) | PASS |
| `/admin/errors` | PASS | PASS (refused) | PASS (refused) | PASS |

`/reports/[id]` is the one route where "refused" is about ownership rather than
role: `lib/routes.ts` marks `/reports` as `scope: "exact"`, so a member may open
their **own** report but not the listing and not anyone else's. The suite
asserts the refusal directly — it is the check that would catch one member
reading another's performance review.

## What the audit found

### 1. `/api/service-leads` was frozen at build time

**Root cause.** The handler reads the database and authenticates nobody — the
roster of who leads what is deliberately public. With no cookie or header read,
nothing marked the route dynamic, so Next prerendered it during `next build`
and wrote the response to `.next/server/app/api/service-leads.body`. That file
was then served for the life of the deployment.

The effect in production: promote someone to service lead and the Service Leads
panel keeps showing the old roster until the next deploy. Every other `GET`
handler escapes this by accident, because authenticating happens to read a
cookie.

**Fix.** `export const dynamic = "force-dynamic"`, and `npm run smoke` now fails
if any API route has been prerendered — checked from the build output, because
no request-level assertion can see it.

### 2. The member dashboard fired a request that could only be refused

**Root cause.** `<ReviewQueue />` was mounted for everyone and treated a 403 as
"nothing to show". That reads as defensive, but it meant every member's
dashboard made an admin-only request on every load and logged a console error
receiving the refusal — noise in exactly the signal this audit depends on.

**Fix.** The server already knows who leads what. The component is mounted only
for someone who can hold a queue.

### 3. Nothing recorded a page failing

The reason the reported `/clients` breakage could not be traced is that no
record of it existed. Reproduction was attempted across dev and production
builds, seeded and empty databases, all three roles, and every interactive
control on the page; it renders cleanly in all of them.

That is not proof it never happened — it is proof that a failure left no
evidence. The `SystemError` table, the boundary reporting and `/admin/errors`
exist so the next one is a route, a stack trace and a timestamp instead of a
memory.

## Known gaps

Recorded rather than quietly omitted:

- **Interactive depth.** The browser pass loads each page and lets it hydrate.
  It clicks nothing. Modals, wizards and multi-step forms are only covered on
  first render — `/clients` was additionally click-swept by hand during this
  audit (11 controls, all clean), but that is not automated.
- **`/reports/[id]` as a member.** Asserted as a refusal, because the smoke
  accounts own no reports. The success path — a member opening their own report
  — is covered by the seeded walkthrough, not by the suite.
- **Postgres.** All of the above ran on SQLite, which is what local development
  uses. The schema is Postgres-compatible and was verified separately, but this
  route matrix has not been run against Postgres.

---

# BWM acceptance audit — the client's 12 points

Run 9 September 2026 against `feb0d2c`, before any tag. Nothing was fixed while
auditing; this records what 1.0.0 actually is, not what the checklist hopes.

Mechanical points were verified directly against the repository and the
database. Functional points were exercised over HTTP through the same endpoints
the UI uses, signing in as Coach D (ADMIN) and Cheryl (MEMBER, Culture Plus
only). Where a point passes only in part, it is marked **FAIL** — a qualified
pass is how a gap survives to production.

## Result

**7 of 12 pass.** Not releasable as 1.0.0.

| # | Point | Result |
| --- | --- | --- |
| 1 | Zero old-agency references anywhere | **FAIL** |
| 2 | 4 departments live and admin-editable | PASS |
| 3 | Only the new team exists | PASS |
| 4 | Memberships + skills configured and editable | PASS |
| 5 | Client creation department-first with dynamic fields | **FAIL** |
| 6 | Assignment shows only department members, skill-recommended | PASS |
| 7 | Every CRUD surface functional, with persistence | PASS |
| 8 | Every dashboard number traces to a query | **FAIL** |
| 9 | Permissions department-aware and server-enforced | **FAIL** |
| 10 | Full journey per department, end to end | PASS |
| 11 | UI/design pixel-untouched | **FAIL** |
| 12 | Production-ready | **FAIL** |

## The five failures

### 1 — Old agency references survive, in the README above all

`README.md` was in Phase T1's rebrand scope and was never swept. It is still
titled **"# Agency OS"**, describes "a remote 360° digital marketing agency",
and documents sign-in credentials that do not exist: `admin@agency.local` /
`admin123` (line 51), plus `someone@agency.local` in the promote examples
(lines 254–255). `DEPLOY.md` line 21 still carries the old directory name.

Twelve-plus user-visible strings say "the agency" rather than BWM — the
dashboard's own description, several 403 messages a user reads verbatim
("Only the agency owner can reassign a lead"), and the delivery board's copy.

Clean, and verified so: code identifiers, page metadata, the PWA manifest, the
package name, seed data, email templates and test fixtures. `seed.agency.archive`
is a deliberately retained reference file. "Ayesha"/"Bilal" in the mention-parser
fixtures were never roster names — T1 recorded over-reaching onto them and
reverting.

T1's entry claimed "zero references … survive **in code**". That was true and is
still true. The acceptance point says *anywhere*, and the README is where a new
developer starts.

### 5 — Client onboarding is still department-last

`ClientWizard.tsx` references neither `DepartmentPicker` nor `DynamicFields`.
Lead creation was converted in T2 and is department-first with the correct
per-department fields; client onboarding was not, and still asks its original
questions in its original order. Known and recorded at the end of T2; unchanged.

### 8 — The dashboard does not use the analytics layer

`lib/analytics.ts` returns 12 scoped totals and 3 charts, is unit-tested, and is
served by `/api/analytics` — but `app/(app)/dashboard/page.tsx` does not import
it and has no filter bar. The page still runs its own older per-metric queries.

Its numbers do each come from a query, so the point passes on its narrowest
reading. It fails on the one that matters: there is no Department × Member ×
Date-range filter, and the metric set the client asked for (new leads in range,
won/lost counts and values, revenue, conversion rate, per-department and
per-member tables) is not on the page.

### 9 — One aggregate on the member dashboard is not department-scoped

The API layer is scoped and proven: `permtest` runs 194 checks including 23
cross-department ones, asserting in both directions that Cheryl receives her own
Culture Plus records and none from the other three via lists, search, partial
phone search, `/api/analytics` and direct fetch, and that Tayyaba is refused 403
on every mutation against an Affiliates lead.

The dashboard **page** bypasses that layer. It is a server component that queries
Prisma directly, and `departmentScope` appears in it zero times:

```ts
prisma.client.count({ where: { status: "ACTIVE" } })   // every department
```

A member's "Active clients" tile counts every active client in the business.
T4 §3 requires the opposite in as many words: *aggregates on member dashboards
must be computed only over permitted departments.*

**Currently latent, not observable**: the database holds 0 clients and 0 leads,
so the tile reads 0 for everyone. It becomes a live cross-department disclosure
the day the first client is onboarded.

**My leak tests did not catch this**, and that is worth recording as its own
finding. They exercise API endpoints; this is a server component reading the
database directly, so it sits in the one place the harness cannot see. Any fix
should extend the harness to render the page as a member, not just to scope the
query.

### 11 — The design system is untouched; individual screens are not

Two different claims, and only one of them holds.

**Untouched, verified by diff across the whole fork** (`5109586..HEAD`):
`components/ui/**` — every primitive — plus `tailwind.config.ts`,
`app/globals.css` and `app/layout.tsx`. Zero lines. No token, no colour, no
type scale, no spacing, no primitive was altered in T2, T3 or T4.

**Changed, necessarily**: thirteen existing screens gained layout as they gained
features — department chips on the clients browser, the department switcher and
commissions table on the pipeline board, the three-step lead wizard, the timeline
replacing the drawer's bespoke activity section, a stat tile on the dashboard, a
renamed nav entry. Ten new components were added, all composed from existing
primitives.

Nothing was restyled. But "pixel-untouched" is false for any screen that gained a
control, so the point fails as written. One deliberate design change was made and
reverted: a login-page refinement in an early session, restored byte-for-byte to
its committed state once CLAUDE.md's Doctrine 1 was read.

### 12 — Not production-ready

- **`seed:prod` does not exist.** `db:seed:admin` is the nearest equivalent and
  does the right shape of thing — owner plus service catalogue, credentials from
  the environment, validated, no demo data — but the named script is absent.
- **It does not force a password change.** `prisma/seed-admin.ts` never sets
  `mustChangePassword`, so a production owner seeded today keeps whatever
  password was passed, indefinitely. CLAUDE.md requires that placeholder
  credentials never survive first contact with a real user; the demo seed obeys
  it and the production seed does not.
- **The README is not updated for BWM** — see point 1. Backups *are* documented
  properly (§5, provider snapshots and `BACKUP_DIR`), and deployment is covered
  in `DEPLOY.md`.
- The gate itself is green — see below.

## What is green

```
npx tsc --noEmit      ✓ clean
npm test              ✓ 434/434
npm run smoke         ✓ every route × every role
npm run smoke:empty   ✓ every route × every role
npm run permtest      ✓ 194 checks, incl. 23 cross-department
npm run leaks         ✓ no owner-only value reached a non-owner
npm run fieldtest     ✓ 45 checks
npm run journeytest   ✓ 78 checks
npm run smoke:browser ✓ 69 pages hydrated across 3 roles
```

## Evidence for the passes

**2** — 4 active departments; `GET /api/departments` 200; `PATCH` edit 200;
reorder route present (`POST`); per-department stage and field endpoints 200.

**3** — exactly six users, roles as specified: Coach D ADMIN, Raja Zain
SUPPORT_ADMIN, Tayyaba / Claire / Cam / Cheryl MEMBER. The seed creates no others.

**4** — 17 memberships, skills populated, `PUT` membership edit 200.

**6** — `fieldtest` asserts, per department and in both directions, that the
assignee list is exactly that department's membership; the picker shows the
Recommended badge and each member's open-lead count.

**7** — exercised end to end and re-read from the database afterwards: create,
edit, assign, stage change, log activity, create task, complete task, set
follow-up, search by name, search by partial phone, delete. All succeeded; the
edit, the follow-up and the deletion all persisted.

**10** — `journeytest`, 78 checks: Pilot Cars inquiry → Completed carrying a
quote, Insurance → Converted → Active Client, Affiliate → Active with commission
computed from value × rate, Culture Plus → Won; each stage move logged, the
lifecycle flipped, LOST refused without a reason, and a non-member's request for
another department's board answered 403.

## What this means for the tag

`bwm-v1.0.0` was not applied. Four of the five failures are finishable work
(README sweep, ClientWizard, dashboard wiring, `seed:prod`). The fifth — point 11
— is a wording question for the client rather than a defect: no styling changed,
but screens that gained features are not pixel-identical, and only they can say
whether that was the intent.
