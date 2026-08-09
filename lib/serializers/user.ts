import type { Viewer } from "@/lib/visibility";
import { canSeeMemberNumbers } from "@/lib/visibility";

/**
 * People.
 *
 * Identity is public within the agency — you cannot collaborate with someone
 * whose name and role you are not allowed to see. Their *numbers* are not: a
 * score, an on-time rate and an attendance record are performance data, and
 * the matrix limits those to yourself, your pod if you lead one, and the owner.
 *
 * The personal phone number on a User row is for the optional WhatsApp channel
 * and is never anyone else's business, owner included in the UI sense — it is
 * omitted here for everyone but the person themselves.
 */

export type UserSource = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string;
  avatarColor: string;
  isActive: boolean;
  isBusinessDev?: boolean;
  weeklyCapacityHours?: number;
  phone?: string | null;
  /** Performance, only present when the caller has already computed it. */
  score?: number | null;
  onTimeRate?: number | null;
  load?: number | null;
  attendanceRate?: number | null;
};

export type SerializedUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  jobTitle: string;
  avatarColor: string;
  isActive: boolean;
  isBusinessDev?: boolean;
  weeklyCapacityHours?: number;
  phone?: string | null;
  score?: number | null;
  onTimeRate?: number | null;
  load?: number | null;
  attendanceRate?: number | null;
};

export function serializeUser(user: UserSource, viewer: Viewer): SerializedUser {
  const result: SerializedUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    jobTitle: user.jobTitle,
    avatarColor: user.avatarColor,
    isActive: user.isActive,
  };

  // Capacity drives the assignment bars, so it travels with identity rather
  // than with performance — knowing someone is at 38 of 40 hours is how you
  // avoid handing them a fifth milestone.
  if (user.weeklyCapacityHours !== undefined) {
    result.weeklyCapacityHours = user.weeklyCapacityHours;
  }
  if (user.isBusinessDev !== undefined) result.isBusinessDev = user.isBusinessDev;

  // A personal number is the person's own.
  if (viewer.id === user.id || viewer.role === "ADMIN") {
    if (user.phone !== undefined) result.phone = user.phone;
  }

  if (canSeeMemberNumbers(viewer, user.id)) {
    if (user.score !== undefined) result.score = user.score;
    if (user.onTimeRate !== undefined) result.onTimeRate = user.onTimeRate;
    if (user.load !== undefined) result.load = user.load;
    if (user.attendanceRate !== undefined) result.attendanceRate = user.attendanceRate;
  }

  return result;
}

export const serializeUsers = (users: readonly UserSource[], viewer: Viewer): SerializedUser[] =>
  users.map((user) => serializeUser(user, viewer));
