import type { DefaultSession } from "next-auth";
import type { Role } from "@/lib/constants";

/**
 * The session carries role, jobTitle and avatarColor so the shell can render
 * the sidebar identity and gate admin UI without an extra database round trip.
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: Role;
      jobTitle: string;
      avatarColor: string;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    role: Role;
    jobTitle: string;
    avatarColor: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: Role;
    jobTitle: string;
    avatarColor: string;
  }
}
