# Ad platform integrations — not built

Client KPIs are typed in by hand. That is a deliberate v1, not an oversight:
the numbers are worth having *now*, and a week of OAuth plumbing before anyone
has proved they will look at a ROAS chart is a week spent on the wrong thing.

This directory documents where the automation would slot in, so the decision
is a decision rather than something rediscovered in six months.

## What exists today

```
lib/kpi.ts          pure arithmetic — ROAS, conversion, trends, the alert rule
lib/kpi-service.ts  reads and writes ClientKpiEntry, fires the alert
ClientKpiEntry      one row per client per week, entered by a human
```

The seam is `ClientKpiEntry`. Anything that can produce
`{ clientId, weekStart, googleSpend, metaSpend, revenue, orders, storeSessions }`
can write through `saveKpiWeek()` and every chart, alert and report downstream
works unchanged. The entry form, the sync job and a CSV import are all just
different producers of the same row.

## What a real integration needs

### Google Ads

- **API**: Google Ads API v17+, `customers/{id}/googleAds:searchStream`.
- **Auth**: OAuth 2.0 with a refresh token per connected account, plus a
  developer token on the agency's manager account.
- **Query**: `metrics.cost_micros` and `metrics.conversions_value` from
  `customer` segmented by `segments.week`.
- **Watch out**: costs come back in micros — divide by 1,000,000. The API
  reports in the *account's* currency and time zone, neither of which is
  necessarily the agency's.

### Meta

- **API**: Marketing API v21+, `/{ad_account_id}/insights`.
- **Auth**: a long-lived system user token; ad account access is granted per
  client through Business Manager.
- **Query**: `spend` and `purchase_roas` with `time_increment=7`.
- **Watch out**: attribution windows are set per request and default to
  something different from Google's. Two platforms reporting "revenue" on
  different windows will not sum to the store's own number, which is why
  `revenue` here should keep coming from the **store**, not from either ad
  platform.

### Store revenue, orders, sessions

Shopify Admin API (`/admin/api/2024-10/orders.json`, plus the Analytics API
for sessions) is the natural source, and the honest one: it is where the money
actually landed.

## The shape it would take

```ts
// lib/integrations/google-ads.ts
export async function fetchWeek(
  connection: AdAccountConnection,
  weekStart: Date,
): Promise<{ spend: number }>;

// lib/integrations/meta-ads.ts   — same signature
// lib/integrations/shopify.ts    — { revenue, orders, storeSessions }
```

Then a nightly job in `lib/evaluate.ts`, beside the others, calling
`saveKpiWeek()` per connected client. A new `AdAccountConnection` model would
hold the per-client credentials.

## Two things to decide before building it

1. **Manual entries must win.** If a sync overwrites a number someone
   corrected by hand, they will stop correcting numbers. `ClientKpiEntry`
   would need a `source` column (`MANUAL` | `SYNCED`) and the job would have
   to leave manual rows alone.

2. **A failed sync must be visible, not silent.** A ROAS chart that quietly
   stops updating is worse than no chart, because it still looks authoritative.
   The alert in `checkRoasAlert` fires on *low* ROAS; nothing currently fires
   on *missing* weeks, and automation would make that gap matter.
