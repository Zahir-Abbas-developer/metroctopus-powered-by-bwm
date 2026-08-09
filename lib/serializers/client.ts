import type { Viewer } from "@/lib/visibility";
import { canSeeClientPhone, canSeeRetainer } from "@/lib/visibility";

/**
 * Client records.
 *
 * The matrix splits a client in two. Who they are — name, contact, email,
 * industry, country, what they bought and what the brief says — goes to
 * everyone who works on them, because you cannot deliver work you are not
 * allowed to read the requirements for. What they pay us, and the phone number
 * the owner uses to chase it, is the owner's.
 */

/** Every field the app reads off a client. Keep in step with the schema. */
export type ClientSource = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  industry: string | null;
  country: string | null;
  monthlyBudget: number;
  status: string;
  notes: string | null;
  targetRoas: number | null;
  startDate: Date | string | null;
  createdAt: Date | string;
};

export type SerializedClient = {
  id: string;
  businessName: string;
  contactName: string;
  email: string;
  industry: string | null;
  country: string | null;
  status: string;
  notes: string | null;
  targetRoas: number | null;
  startDate: string | null;
  createdAt: string;
  /** Owner only. Absent for everyone else. */
  phone?: string | null;
  /** Owner only. Absent for everyone else. */
  monthlyBudget?: number;
};

const iso = (value: Date | string | null): string | null =>
  value === null ? null : typeof value === "string" ? value : value.toISOString();

export function serializeClient(client: ClientSource, viewer: Viewer): SerializedClient {
  const result: SerializedClient = {
    id: client.id,
    businessName: client.businessName,
    contactName: client.contactName,
    email: client.email,
    industry: client.industry,
    country: client.country,
    status: client.status,
    notes: client.notes,
    // Operational: the ROAS a campaign is judged against belongs to whoever
    // runs the campaign. What the client pays us for it does not.
    targetRoas: client.targetRoas,
    startDate: iso(client.startDate),
    createdAt: iso(client.createdAt) as string,
  };

  if (canSeeClientPhone(viewer)) result.phone = client.phone;
  if (canSeeRetainer(viewer)) result.monthlyBudget = client.monthlyBudget;

  return result;
}

export const serializeClients = (
  clients: readonly ClientSource[],
  viewer: Viewer,
): SerializedClient[] => clients.map((client) => serializeClient(client, viewer));
