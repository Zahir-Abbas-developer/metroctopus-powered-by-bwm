import { getCurrentUser } from "@/lib/session";
import { hasAdminPower } from "@/lib/constants";
import { isModuleEnabled, type ModuleKey } from "@/lib/modules";
import { ModuleDisabled } from "@/components/layout/ModuleDisabled";

/**
 * Gate for a parked module's page.
 *
 *   const gate = await moduleGate("scoring");
 *   if (gate) return gate;
 *
 * Returns the disabled screen, or null when the module is live. It is a render
 * result rather than a `notFound()` on purpose: `notFound()` would hand the
 * visitor the generic 404, losing the one thing worth saying here — that the
 * feature exists and is switched off, and who can switch it back on.
 *
 * The nav entry and dashboard cards are already gone by the time anyone can
 * reach this, so it guards a bookmark or a typed URL rather than a link.
 */
export async function moduleGate(key: ModuleKey) {
  if (await isModuleEnabled(key)) return null;

  const user = await getCurrentUser();
  return (
    <ModuleDisabled module={key} canManage={user ? hasAdminPower(user.role) : false} />
  );
}
