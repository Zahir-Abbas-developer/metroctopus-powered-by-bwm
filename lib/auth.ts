import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import type { Role } from "@/lib/constants";
import { LOGIN_ROUTE } from "@/lib/routes";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 60 * 60 * 24 * 7, // one week
  },
  pages: {
    signIn: LOGIN_ROUTE,
    error: LOGIN_ROUTE,
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email } });
        // Same null result for "no such user" and "wrong password" so the
        // login form cannot be used to enumerate who works here.
        if (!user || !user.isActive) return null;

        const passwordMatches = await bcrypt.compare(password, user.passwordHash);
        if (!passwordMatches) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
          jobTitle: user.jobTitle,
          avatarColor: user.avatarColor,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.jobTitle = user.jobTitle;
        token.avatarColor = user.avatarColor;
        return token;
      }

      // Re-read on explicit update so a role change or deactivation takes
      // effect without the user having to sign out and back in.
      if (trigger === "update" && token.id) {
        const fresh = await prisma.user.findUnique({ where: { id: token.id } });
        if (fresh && fresh.isActive) {
          token.name = fresh.name;
          token.email = fresh.email;
          token.role = fresh.role as Role;
          token.jobTitle = fresh.jobTitle;
          token.avatarColor = fresh.avatarColor;
        }
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.jobTitle = token.jobTitle;
        session.user.avatarColor = token.avatarColor;
      }
      return session;
    },
  },
};
