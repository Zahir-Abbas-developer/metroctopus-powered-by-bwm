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
