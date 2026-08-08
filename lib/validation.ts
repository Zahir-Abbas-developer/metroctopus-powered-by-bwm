import { z } from "zod";

import { ROLES } from "@/lib/constants";

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
