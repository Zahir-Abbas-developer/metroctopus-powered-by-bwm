import type { Viewer } from "@/lib/visibility";
import { canSeeClientBrief } from "@/lib/visibility";

/**
 * Projects, modules and milestones.
 *
 * Delivery data carries no agency money, so almost all of it is visible to
 * whoever works on it — the matrix's restriction here is about *which clients*
 * a person can reach, not which fields. A member sees the projects of clients
 * they are assigned to; a lead sees every client, because their approval
 * authority spans a service line rather than a client list.
 *
 * The one field that needs stripping is the client's retainer, which reaches
 * this shape whenever a project is serialised with its client attached.
 */

export type ProjectSource = {
  id: string;
  title: string;
  clientId: string;
  status: string;
  startDate: Date | string;
  endDate: Date | string | null;
  client?: { id: string; businessName: string; monthlyBudget?: number } | null;
  [key: string]: unknown;
};

export type SerializedProject = Omit<ProjectSource, "startDate" | "endDate" | "client"> & {
  startDate: string;
  endDate: string | null;
  client?: { id: string; businessName: string; monthlyBudget?: number } | null;
};

const iso = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value : value.toISOString();

/** Null when the viewer has no business with the client this project is for. */
export function serializeProject(
  project: ProjectSource,
  viewer: Viewer,
): SerializedProject | null {
  if (!canSeeClientBrief(viewer, project.clientId)) return null;

  const { client, ...rest } = project;

  const serialized: SerializedProject = {
    ...rest,
    startDate: iso(project.startDate) as string,
    endDate: iso(project.endDate),
  };

  if (client) {
    // The nested client is identity only; the retainer never rides along.
    const { monthlyBudget, ...identity } = client;
    serialized.client =
      viewer.role === "ADMIN" ? { ...identity, monthlyBudget } : identity;
  }

  return serialized;
}

export function serializeProjects(
  projects: readonly ProjectSource[],
  viewer: Viewer,
): SerializedProject[] {
  return projects
    .map((project) => serializeProject(project, viewer))
    .filter((project): project is SerializedProject => project !== null);
}
