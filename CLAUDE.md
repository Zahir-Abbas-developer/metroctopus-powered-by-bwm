# Agency OS

Internal management platform for a remote 360° digital marketing agency.

## The Business

The agency provides end-to-end services to e-commerce clients:

- Shopify store design & development
- Google Ads
- Meta (Facebook/Instagram) Ads
- Creative research & design
- Full funnel management, from website to sales

Clients work on **monthly retainers**. The team is **fully remote**: 1 owner/admin + 6 team members (designers, marketers, developers).

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

## Roles

- **ADMIN** (the owner) — sees everything, manages clients, assigns work, views all reports
- **MEMBER** (team) — sees only their own assigned tasks, milestones, and personal performance reports

## Conventions

- Keep components small and reusable in `/components`
- All dates handled with a single date utility; timezone: **Asia/Karachi**
- After completing any significant feature, append a summary to `PROGRESS.md`
