import type { Role } from "@/lib/constants";

/** A user as returned by /api/team — dates arrive as ISO strings over JSON. */
export type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: Role;
  jobTitle: string;
  avatarColor: string;
  isActive: boolean;
  createdAt: string;
};
