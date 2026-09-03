import { z } from "zod";

import {
  CLIENT_STATUSES,
  MILESTONE_STATUSES,
  PROJECT_STATUSES,
  ROLES,
  WEIGHT_MAX,
  WEIGHT_MIN,
} from "@/lib/constants";

/**
 * Shared request schemas. The API validates with these; the forms reuse the
 * same rules so client and server can never disagree about what's valid.
 */

export const MIN_PASSWORD_LENGTH = 8;

const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80, "Name must be 80 characters or fewer");

const email = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address")
  .max(160, "Email must be 160 characters or fewer");

const jobTitle = z
  .string()
  .trim()
  .min(2, "Job title must be at least 2 characters")
  .max(60, "Job title must be 60 characters or fewer");

const password = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  .max(72, "Password must be 72 characters or fewer"); // bcrypt's input ceiling

const role = z.enum(ROLES);

export const createUserSchema = z.object({
  name,
  email,
  jobTitle,
  role: role.default("MEMBER"),
  password,
});

export const updateUserSchema = z
  .object({
    name: name.optional(),
    email: email.optional(),
    jobTitle: jobTitle.optional(),
    role: role.optional(),
    isActive: z.boolean().optional(),
    /** Omit or send an empty string to leave the password unchanged. */
    password: z.union([password, z.literal("")]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Nothing to update",
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");

export const clientDetailsSchema = z.object({
  businessName: z
    .string()
    .trim()
    .min(2, "Business name must be at least 2 characters")
    .max(120, "Business name must be 120 characters or fewer"),
  contactName: z
    .string()
    .trim()
    .min(2, "Contact name must be at least 2 characters")
    .max(80, "Contact name must be 80 characters or fewer"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  /// The business line this client belongs to. Required at creation: a client
  /// with no department is invisible to every department-scoped query.
  departmentId: z.string().min(1, "Pick a department"),
  phone: z.string().trim().max(40, "Phone must be 40 characters or fewer").optional(),
  country: z.string().trim().max(60, "Country must be 60 characters or fewer").optional(),
  industry: z.string().trim().max(60, "Industry must be 60 characters or fewer").optional(),
  monthlyBudget: z
    .number({ invalid_type_error: "Enter a monthly budget" })
    .int("Use whole currency units")
    .min(0, "Budget cannot be negative")
    .max(10_000_000, "That budget looks wrong"),
  status: z.enum(CLIENT_STATUSES).default("ACTIVE"),
  notes: z.string().trim().max(5000, "Notes must be 5000 characters or fewer").optional(),
  /** Off means the nightly job never opens a new cycle for this client. */
  autoRenew: z.boolean().optional(),
  /** Null means "use the agency default" rather than "no target". */
  targetRoas: z.number().min(0).max(100).nullish(),
});

/** The whole 3-step onboarding wizard arrives as one request. */
export const onboardClientSchema = clientDetailsSchema.extend({
  serviceIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one service")
    .max(20),
  projectTitle: z
    .string()
    .trim()
    .min(2, "Give the first engagement a title")
    .max(120, "Title must be 120 characters or fewer"),
  startDate: dateOnly,
});

export const updateClientSchema = clientDetailsSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: "Nothing to update" },
);

// ---------------------------------------------------------------------------
// Projects, modules, milestones
// ---------------------------------------------------------------------------

export const createProjectSchema = z.object({
  clientId: z.string().min(1),
  title: z.string().trim().min(2, "Give the engagement a title").max(120),
  startDate: dateOnly,
  /** Optional: defaults to startDate + PROJECT_LENGTH_DAYS. */
  endDate: dateOnly.optional(),
  serviceIds: z.array(z.string().min(1)).min(1, "Select at least one service").max(20),
});

export const updateProjectSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    startDate: dateOnly.optional(),
    endDate: dateOnly.optional(),
    status: z.enum(PROJECT_STATUSES).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export const createModuleSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().trim().min(2, "Name the workstream").max(80),
  serviceId: z.string().min(1).nullish(),
});

export const milestoneFieldsSchema = z.object({
  title: z.string().trim().min(2, "Give the milestone a title").max(140),
  description: z.string().trim().max(2000).optional(),
  weight: z
    .number({ invalid_type_error: "Pick a weight" })
    .int()
    .min(WEIGHT_MIN, `Weight is ${WEIGHT_MIN}–${WEIGHT_MAX}`)
    .max(WEIGHT_MAX, `Weight is ${WEIGHT_MIN}–${WEIGHT_MAX}`),
  dueDate: dateOnly,
  /** Rough effort, for capacity planning. Never touches scoring. */
  estimatedHours: z.number().int().min(0).max(200).optional(),
  assigneeId: z.string().min(1).nullish(),
});

export const createMilestoneSchema = milestoneFieldsSchema.extend({
  moduleId: z.string().min(1),
});

export const updateMilestoneSchema = milestoneFieldsSchema
  .partial()
  .extend({ order: z.number().int().min(0).optional() })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to update" });

export const reorderMilestonesSchema = z.object({
  moduleId: z.string().min(1),
  /** Milestone ids in their new order. */
  ids: z.array(z.string().min(1)).min(1).max(200),
});

// ---------------------------------------------------------------------------
// Status transitions and scoring
// ---------------------------------------------------------------------------

export const transitionSchema = z.object({
  status: z.enum(MILESTONE_STATUSES),
  /**
   * Required when an admin rejects submitted work. Enforced by the route
   * rather than here, because it only applies to the SUBMITTED -> IN_PROGRESS
   * transition and Zod would otherwise demand it on every status change.
   */
  reason: z.string().trim().max(500).optional(),
  /**
   * 1–5, required when an admin approves. Enforced by the route for the same
   * reason as `reason` — it only applies to one transition, and Zod would
   * otherwise demand it on every status change.
   */
  qualityRating: z.number().int().min(1).max(5).optional(),
  qualityComment: z.string().trim().max(1000).optional(),
});

/** A rejection must say why — the member is being charged points for it. */
export const rejectionSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Explain what needs reworking — the member is charged points for this")
    .max(500, "Keep the reason under 500 characters"),
});

export const manualAdjustSchema = z.object({
  userId: z.string().min(1),
  points: z
    .number({ invalid_type_error: "Enter a points value" })
    .min(-100, "Adjustment cannot be below -100")
    .max(100, "Adjustment cannot be above 100")
    .refine((value) => value !== 0, "An adjustment of zero does nothing")
    .refine(
      (value) => Number.isInteger(value * 2),
      "Use whole or half points",
    ),
  reason: z
    .string()
    .trim()
    .min(5, "A manual adjustment must be justified in writing")
    .max(500, "Keep the reason under 500 characters"),
});

export type OnboardClientInput = z.infer<typeof onboardClientSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateMilestoneInput = z.infer<typeof createMilestoneSchema>;
export type ManualAdjustInput = z.infer<typeof manualAdjustSchema>;

/** Flatten a ZodError into `{ field: message }` for form display. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}
