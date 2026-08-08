# Agency OS

Internal management platform for a remote 360° digital marketing agency.

## The Business

The agency provides end-to-end services to e-commerce clients:

- Shopify store design & development
- Google Ads
- Meta (Facebook/Instagram) Ads
- Creative research & design
- Full funnel management, from website to sales

Clients work on **monthly retainers**. The team is **fully remote**: 1 owner/admin + 4 team members.

### The team

| Name | Role | Job title |
| --- | --- | --- |
| Raja Zain | ADMIN | Founder · Client Acquisition & Scaling |
| Subtain | MEMBER | Performance Marketer |
| Saad Tariq | MEMBER | Business Developer |
| Shahnawaz | MEMBER | Shopify Designer · AI Websites · Product Hunting |
| Shahzaib | MEMBER | Ecommerce Marketplaces · Sourcing · AI SEO |

People wear more than one hat here, so a job title covers several
specialisms rather than one. Anything that maps work to a person — the
auto-assignment defaults in `lib/templates.ts`, for instance — has to match
against these titles, not against single-discipline labels.

## The Problem Being Solved

Everything is currently managed manually over chat. The owner must personally message team members to start work. There is:

- No visibility into who is doing what
- No deadline enforcement
- No objective way to measure team performance

## The Solution

A web app where:

1. Clients are onboarded with their required services.
2. Each client's monthly engagement is broken into **modules** and **milestones** with deadlines.
3. Tasks are **auto-assigned** to dedicated team members.
4. An automatic **performance scoring engine** starts every team member at **100 points per month** and deducts points for missed deadlines and quality issues.
5. **Weekly and monthly performance reports** are generated for the owner and for each team member.

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

## Working hours & attendance

### Hours

- **12:00 – 22:00**, timezone **Asia/Karachi** (already the project timezone)
- **Monday – Saturday**; Sunday is off
- Workdays and hours are fixed for now, and become **admin-configurable later**

### Attendance philosophy

Clock-in / clock-out on its own is **not trusted**. A button can be tapped from
a phone anywhere, so it proves only that someone had their phone — not that
they were working.

Instead, the system issues **3 random, hidden availability checks per member
per day**. They are unannounced and unpredictable, so they cannot be planned
around. Responding on time is what proves a member is genuinely reachable
during working hours.

### Scoring

Attendance feeds the monthly performance score through the **existing
`ScoreEvent` engine** — not a parallel scoring system. The rules in
`lib/scoring.ts` stay the single source of truth for how points move, and a
member's score remains `100 + sum(that month's events)`.

## Roles

- **ADMIN** (the owner) — sees everything, manages clients, assigns work, views all reports
- **MEMBER** (team) — sees only their own assigned tasks, milestones, and personal performance reports

## Conventions

- Keep components small and reusable in `/components`
- All dates handled with a single date utility; timezone: **Asia/Karachi**
- After completing any significant feature, append a summary to `PROGRESS.md`

## Fairness & Leverage Doctrine

Governs **Phases 8–11**. These eight principles outrank anything earlier in
this file that contradicts them, and where one does, the conflict is named
below. A scoring system people believe is unfair gets gamed or ignored, so
fairness here is a functional requirement, not a courtesy.

### 1. Deadlines are judged on submission, never approval

A member's deadline is met the moment they **submit**. Approval time is the
owner's latency, not theirs, and must never move a member's score.

The owner's review speed becomes **the owner's own tracked metric** — time from
submission to decision, visible in the same reports the team is measured by.

> **Overrides:** the current engine charges LATE and pays `EARLY_BONUS` against
> `completedAt`, which is set at approval. `lib/scoring.ts` and every call site
> must switch to `submittedAt`, and historical events keep their old basis
> rather than being silently recomputed.

### 2. Nobody is penalized for time they cannot control

The clock pauses for anything outside a member's hands:

- **Blocked work** pauses the deadline clock. A milestone waiting on a client
  asset, an ad-account approval or another member's output accrues no lateness
  while blocked.
- **Declared outages** (power cut, internet failure) pause availability checks.
- **Break time** pauses availability checks — see principle 4.

Every pause is a recorded, auditable event with a reason and a duration, not a
silent adjustment. A pause a member can declare freely and unlimited is a hole
in the system, so declared pauses are visible to the owner and reviewable.

### 3. Raw score never appears alone

Wherever a score is shown, **On-Time Rate %** and **Workload** are shown beside
it. A 92 carrying four milestones and a 92 carrying nineteen are not the same
achievement, and a score presented without volume context invites the wrong
conclusion. This applies to the dashboard, the leaderboard, member profiles and
every report.

### 4. Prayer and meal breaks are protected

Within the 12:00–22:00 shift, prayer and meal breaks are a **protected daily
allowance, capped in minutes and never penalized**. Time inside the allowance
issues no availability check and costs no points. Exceeding the allowance is a
normal, visible fact — not a hidden penalty.

The cap and how breaks are declared are decisions for the phase that builds
this; they belong in the `Settings` row alongside the other attendance rules,
not hardcoded.

### 5. Business development is scored on activity and outcomes

Sales pipeline work does not decompose into client milestones, so scoring Saad
Tariq's Business Developer work against milestones would measure the wrong
thing entirely. It is scored on **activity targets** (outreach volume, calls,
proposals) and **outcomes** (deals closed, pipeline value moved).

This is a second scoring path feeding the **same `ScoreEvent` ledger** — a
member's score stays `100 + sum(that month's events)`. It is not a parallel
engine.

### 6. Monthly cycles auto-renew

On the 1st of the month, every active retainer client's next cycle must already
exist — projects, modules, milestones, deadlines and assignments — with **zero
manual setup from the owner**. Renewal is generated from the client's services
and the previous cycle, and the owner edits exceptions rather than building
each month from nothing.

### 7. Money is first-class dashboard data

**Pipeline value, MRR and per-client ROAS** are primary dashboard metrics,
displayed with the same weight as delivery and performance figures. The agency
runs on retainers; a dashboard that shows only task completion tells the owner
how busy the team is but not how the business is doing.

### 8. Consequences are written policy, and every event is disputable

- **Policy in the app.** Whatever a score triggers — bonus eligibility, a
  performance review, a warning — is stated in the product where the team can
  read it. No consequence exists only in the owner's head.
- **Disputes in the app.** Every `ScoreEvent` can be formally disputed by the
  member it charges, with a reason. The owner resolves it, and the resolution
  follows the existing excuse pattern: the original event is **never deleted or
  edited**, and an upheld dispute writes a compensating `MANUAL_ADJUST`. The
  ledger stays append-only, so the record shows both what happened and how it
  was settled.
