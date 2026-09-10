import { prisma } from "@/lib/prisma";
import type { NavKey } from "@/lib/routes";

/**
 * Parked modules — the agency features BWM did not request.
 *
 * Doctrine 5: a flag that is off must make the feature *disappear*. Not an
 * empty panel, not a heading with nothing under it, not a route that throws —
 * absent. That means one registry owns every surface a module reaches: its nav
 * entries, its routes, its dashboard cards and its background jobs. Anything
 * that renders or schedules on a module's behalf asks here first.
 *
 * The code stays. These may be switched back on, and deleting them would turn
 * a settings toggle into a rebuild.
 */

export const MODULES = [
  {
    key: "attendance",
    label: "Attendance",
    description:
      "Clock-in, random availability checks, breaks, leave and outage reports.",
    field: "featureAttendance",
    navKeys: ["my-attendance", "attendance"],
    routePrefixes: ["/my-attendance", "/attendance"],
    apiPrefixes: ["/api/attendance", "/api/leave", "/api/outages"],
  },
  {
    key: "scoring",
    label: "Performance scoring",
    description:
      "The 100-points-a-month score, disputes, incentives and the leaderboard.",
    field: "featureScoring",
    navKeys: ["my-performance", "disputes", "incentives", "scoring"],
    routePrefixes: ["/my-performance", "/disputes", "/incentives", "/scoring"],
    apiPrefixes: ["/api/disputes", "/api/incentives", "/api/score-events", "/api/targets"],
  },
  {
    key: "retainerProjects",
    label: "Retainer projects",
    description:
      "Monthly client cycles broken into projects, modules and milestones, and the delivery board.",
    field: "featureRetainerCycles",
    navKeys: ["board", "projects", "my-tasks"],
    routePrefixes: ["/board", "/projects", "/my-tasks"],
    apiPrefixes: [
      "/api/board",
      "/api/projects",
      "/api/milestones",
      "/api/modules",
      "/api/my-tasks",
    ],
  },
  {
    key: "clientKpis",
    label: "Client KPIs",
    description: "Ad spend, revenue, ROAS and MRR panels on the client record.",
    field: "featureClientKpis",
    navKeys: [],
    routePrefixes: [],
    apiPrefixes: ["/api/clients/kpis"],
  },
] as const;

export type ModuleKey = (typeof MODULES)[number]["key"];
export type ModuleFlags = Record<ModuleKey, boolean>;

/** Everything off — the shape a fresh BWM database starts in. */
export const ALL_MODULES_OFF: ModuleFlags = {
  attendance: false,
  scoring: false,
  retainerProjects: false,
  clientKpis: false,
};

/**
 * Reads the flags. Upserts the singleton for the same reason getSettings()
 * does: a fresh database must not need a seeding step before a page can render.
 */
export async function getModuleFlags(): Promise<ModuleFlags> {
  const row = await prisma.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });

  return {
    attendance: row.featureAttendance,
    scoring: row.featureScoring,
    retainerProjects: row.featureRetainerCycles,
    clientKpis: row.featureClientKpis,
  };
}

export async function isModuleEnabled(key: ModuleKey): Promise<boolean> {
  return (await getModuleFlags())[key];
}

/** Nav keys belonging to a disabled module, so the rail can drop them. */
export function hiddenNavKeys(flags: ModuleFlags): NavKey[] {
  const hidden: NavKey[] = [];
  for (const mod of MODULES) {
    if (flags[mod.key]) continue;
    hidden.push(...(mod.navKeys as readonly NavKey[]));
  }
  return hidden;
}

/** The module owning a path, if any — used to gate a page or an API route. */
export function moduleForPath(pathname: string): ModuleKey | null {
  for (const mod of MODULES) {
    for (const prefix of [...mod.routePrefixes, ...mod.apiPrefixes]) {
      if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return mod.key;
    }
  }
  return null;
}

export function moduleLabel(key: ModuleKey): string {
  return MODULES.find((m) => m.key === key)?.label ?? key;
}
