import { WEIGHT_DEFAULT } from "@/lib/constants";

/**
 * Built-in planning templates.
 *
 * Picking a service during onboarding shouldn't hand the owner a blank page —
 * each one expands into the module and milestones that service actually
 * involves, dated relative to the project start. The owner then edits, adds,
 * removes and reassigns from a real plan instead of building one from nothing.
 *
 * `dayOffset` is days after the project start date. Weights follow the 1–5
 * scale the scoring engine multiplies against, so a botched launch costs more
 * than a late status note.
 */

export type TemplateMilestone = {
  title: string;
  description?: string;
  /** 1–5; see WEIGHT_LABEL. */
  weight: number;
  /** Days after project start. */
  dayOffset: number;
};

export type TemplateModule = {
  name: string;
  milestones: TemplateMilestone[];
};

/** Keyed by ServiceCatalog.slug, which never changes even if the name does. */
export const SERVICE_TEMPLATES: Record<string, TemplateModule> = {
  "shopify-design-development": {
    name: "Shopify Store",
    milestones: [
      {
        title: "Store audit & requirements",
        description:
          "Audit the current store, agree scope, collect brand assets and product data.",
        weight: 3,
        dayOffset: 3,
      },
      {
        title: "Design direction & key page mockups",
        description: "Home, collection and product page mockups signed off by the client.",
        weight: 4,
        dayOffset: 8,
      },
      {
        title: "Theme build & development",
        description: "Build the approved design, wire up apps, migrate content.",
        weight: 5,
        dayOffset: 18,
      },
      {
        title: "QA, speed & mobile pass",
        description: "Cross-browser and mobile QA, Core Web Vitals, checkout testing.",
        weight: 4,
        dayOffset: 24,
      },
      {
        title: "Launch & handover",
        description: "Go live, redirects, analytics verification, walkthrough with the client.",
        weight: 5,
        dayOffset: 28,
      },
    ],
  },

  "google-ads-management": {
    name: "Google Ads",
    milestones: [
      {
        title: "Account & conversion tracking setup",
        description: "Account structure, GA4 and conversion tracking verified end to end.",
        weight: 4,
        dayOffset: 2,
      },
      {
        title: "Campaign structure & launch",
        description: "Keyword research, ad groups, copy and initial budgets live.",
        weight: 5,
        dayOffset: 5,
      },
      {
        title: "Week 2 optimization & report",
        description: "Search term mining, bid and budget adjustments, client update.",
        weight: 3,
        dayOffset: 14,
      },
      {
        title: "Week 3 optimization & report",
        description: "Creative and landing page tests, negative keyword pass.",
        weight: 3,
        dayOffset: 21,
      },
      {
        title: "Week 4 optimization & monthly report",
        description: "Month-end performance review, spend reconciliation, next-month plan.",
        weight: 4,
        dayOffset: 28,
      },
    ],
  },

  "meta-ads-management": {
    name: "Meta Ads",
    milestones: [
      {
        title: "Pixel, CAPI & audience setup",
        description: "Pixel and Conversions API verified, core audiences built.",
        weight: 4,
        dayOffset: 2,
      },
      {
        title: "Campaign structure & launch",
        description: "Prospecting and retargeting campaigns live with approved creative.",
        weight: 5,
        dayOffset: 5,
      },
      {
        title: "Week 2 optimization & report",
        description: "Budget shifts, audience pruning, client update.",
        weight: 3,
        dayOffset: 14,
      },
      {
        title: "Week 3 creative refresh & report",
        description: "Refresh fatigued creative, test new hooks and formats.",
        weight: 3,
        dayOffset: 21,
      },
      {
        title: "Week 4 optimization & monthly report",
        description: "Month-end ROAS review, scaling plan for next cycle.",
        weight: 4,
        dayOffset: 28,
      },
    ],
  },

  "creative-research-design": {
    name: "Creative",
    milestones: [
      {
        title: "Market & competitor creative research",
        description: "Ad library teardown, angle and hook research, reference board.",
        weight: 3,
        dayOffset: 3,
      },
      {
        title: "Concept directions & hooks",
        description: "Three concept directions with scripted hooks, presented for approval.",
        weight: 4,
        dayOffset: 7,
      },
      {
        title: "Creative batch 1 delivery",
        description: "First batch of statics and video cuts, sized for every placement.",
        weight: 4,
        dayOffset: 12,
      },
      {
        title: "Creative batch 2 delivery",
        description: "Second batch, informed by batch 1 performance.",
        weight: 3,
        dayOffset: 20,
      },
      {
        title: "Creative batch 3 delivery",
        description: "Final batch plus a wrap-up of which angles won.",
        weight: 3,
        dayOffset: 27,
      },
    ],
  },

  "full-funnel": {
    name: "Full Funnel",
    milestones: [
      {
        title: "Funnel audit & tracking plan",
        description: "Map website to ads to sales, find the leaks, agree the measurement plan.",
        weight: 4,
        dayOffset: 3,
      },
      {
        title: "Landing page & offer alignment",
        description: "Align landing pages and offers with the ad promise.",
        weight: 4,
        dayOffset: 10,
      },
      {
        title: "Conversion rate experiments",
        description: "Run and document the month's CRO tests.",
        weight: 3,
        dayOffset: 18,
      },
      {
        title: "Attribution & sales handoff review",
        description: "Reconcile platform numbers with actual sales, review the handoff.",
        weight: 4,
        dayOffset: 26,
      },
    ],
  },
};

/**
 * Reporting cadence every engagement gets, regardless of services bought:
 * four weekly client reports, seven days apart.
 *
 * Left unassigned on creation — the spec is explicit that the owner decides
 * who fronts the client each week.
 */
export const WEEKLY_REPORT_MODULE: TemplateModule = {
  name: "Weekly Reporting",
  milestones: [1, 2, 3, 4].map((week) => ({
    title: `Week ${week} client report`,
    description: `Send the week ${week} performance summary to the client.`,
    weight: WEIGHT_DEFAULT,
    dayOffset: week * 7,
  })),
};

/** Modules to generate for a set of selected service slugs, in order. */
export function planFor(serviceSlugs: readonly string[]): {
  slug: string | null;
  module: TemplateModule;
}[] {
  const modules = serviceSlugs
    .map((slug) => ({ slug, module: SERVICE_TEMPLATES[slug] }))
    .filter((entry): entry is { slug: string; module: TemplateModule } =>
      Boolean(entry.module),
    );

  // Reporting always comes last, after the delivery workstreams.
  return [...modules, { slug: null, module: WEEKLY_REPORT_MODULE }];
}

/**
 * Which job titles should own a service's work, best match first.
 *
 * This is a sensible default the owner overrides inline on the project page —
 * not an assignment engine. It exists so a freshly created project arrives with
 * owners attached rather than twenty-five unassigned rows.
 *
 * The titles are matched against the real roster, where people wear several
 * hats, so each entry lists the exact title first and keeps generic
 * single-discipline labels as fallbacks for anyone hired later.
 */
export const SERVICE_JOB_TITLES: Record<string, readonly string[]> = {
  "shopify-design-development": [
    "Shopify Designer · AI Websites · Product Hunting",
    "Shopify Developer",
    "Web Developer",
  ],
  "google-ads-management": [
    "Performance Marketer",
    "Google Ads Specialist",
    "Media Buyer",
  ],
  "meta-ads-management": [
    "Performance Marketer",
    "Meta Ads Specialist",
    "Media Buyer",
  ],
  "creative-research-design": [
    "Ecommerce Marketplaces · Sourcing · AI SEO",
    "Creative Designer",
    "Creative Strategist",
  ],
  "full-funnel": [
    "Business Developer",
    "Funnel Manager",
    "Account Manager",
  ],
};

export type AssignableMember = {
  id: string;
  jobTitle: string;
};

/** The default owner for a service's module, or null when nobody fits. */
export function defaultAssigneeFor(
  slug: string | null,
  members: readonly AssignableMember[],
): string | null {
  if (!slug) return null;

  for (const title of SERVICE_JOB_TITLES[slug] ?? []) {
    const match = members.find(
      (member) => member.jobTitle.toLowerCase() === title.toLowerCase(),
    );
    if (match) return match.id;
  }

  return null;
}
