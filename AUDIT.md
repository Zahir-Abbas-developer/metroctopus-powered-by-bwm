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
