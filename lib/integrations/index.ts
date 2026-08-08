/**
 * Ad platform integrations — deliberately not built.
 *
 * See README.md in this directory for what a real implementation needs, where
 * it would attach, and the two decisions that have to be made first.
 *
 * The seam is `ClientKpiEntry`. Anything that can produce a week's numbers
 * writes through `saveKpiWeek()` in lib/kpi-service.ts, and every chart, alert
 * and report downstream works unchanged. The manual entry form is simply the
 * first producer of that row.
 *
 * This file exists so the seam is a named thing in the codebase rather than a
 * paragraph in a document nobody opens.
 */

export type KpiSource = "MANUAL" | "GOOGLE_ADS" | "META_ADS" | "SHOPIFY";

/** One week of numbers from any source. The shape `saveKpiWeek` accepts. */
export type KpiFetchResult = {
  weekStart: Date;
  googleSpend?: number;
  metaSpend?: number;
  revenue?: number;
  orders?: number;
  storeSessions?: number;
};

/**
 * What every provider would implement.
 *
 * Kept as a type rather than an abstract class because the providers are
 * stateless functions over a credential — there is nothing to inherit.
 */
export type KpiProvider = {
  source: KpiSource;
  /** True when the deployment has credentials for this provider. */
  configured(): boolean;
  fetchWeek(clientId: string, weekStart: Date): Promise<KpiFetchResult>;
};

/**
 * The registry a nightly sync would iterate.
 *
 * Empty on purpose. Adding a provider here and implementing `KpiProvider` is
 * the whole integration surface — no call site downstream changes.
 */
export const PROVIDERS: readonly KpiProvider[] = [];

/** True once any provider is wired up, for hiding "sync now" affordances. */
export function anyProviderConfigured(): boolean {
  return PROVIDERS.some((provider) => provider.configured());
}
