import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";

import { prisma } from "@/lib/prisma";
import { passwordMatches } from "@/lib/passwords";
import { THROTTLED_ERROR, type Role } from "@/lib/constants";
import { LOGIN_ROUTE } from "@/lib/routes";
import {
  LOGIN_IP_LIMIT,
  LOGIN_LIMIT,
  LOGIN_WINDOW_MS,
  clientIp,
  consume,
  reset,
} from "@/lib/rate-limit";

/*
 * Throttling is reported rather than disguised, which reverses an earlier
 * decision here. The old code returned the same answer as a wrong password, on
 * the grounds that telling an attacker they had been throttled is information.
 * It is — and it is information they can measure anyway, by timing, or by
 * noticing that correct credentials also stop working. What it actually bought
 * was a real user staring at "those credentials didn't work" while holding the
 * right password, with no way to learn that waiting would fix it. That trade is
 * a bad one for a six-person internal tool.
 *
 * A thrown error's message becomes the `error` value on the sign-in result, so
 * THROTTLED_ERROR is the wire format between here and the login form.
 */

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
      async authorize(credentials, request) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;

        /* Two buckets: one per account, so nobody can grind through one
           person's passwords from many addresses, and one per source address,
           so a single machine cannot walk the roster.

           The address bucket is skipped entirely when the request arrived with
           no proxy header to identify it. Counting those together under one
           placeholder key meant every visitor shared a bucket, and eight failed
           attempts by anyone locked out everyone. */
        const headers = new Headers(
          (request?.headers as Record<string, string> | undefined) ?? {},
        );
        const ip = clientIp(headers);

        const limits: { key: string; limit: number }[] = [
          { key: `login:user:${email}`, limit: LOGIN_LIMIT },
          ...(ip ? [{ key: `login:ip:${ip}`, limit: LOGIN_IP_LIMIT }] : []),
        ];

        for (const { key, limit } of limits) {
          const result = consume(key, limit, LOGIN_WINDOW_MS);
          if (!result.allowed) {
            console.warn(`[auth] rate limited ${key}`);
            throw new Error(`${THROTTLED_ERROR}:${result.retryAfter}`);
          }
        }

        const user = await prisma.user.findUnique({ where: { email } });
        // Same null result for "no such user" and "wrong password" so the
        // login form cannot be used to enumerate who works here.
        if (!user || !user.isActive) return null;

        if (!(await passwordMatches(password, user.passwordHash))) return null;

        // A good password clears the account bucket, so someone who mistyped
        // a few times isn't locked out once they get it right.
        reset(`login:user:${email}`);
        if (ip) reset(`login:ip:${ip}`);

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
