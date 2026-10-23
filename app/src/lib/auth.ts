import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { resolveActiveMembership } from "@/lib/membership";

/**
 * Sessions are JWTs, but *what a user may do* is not trusted from the token: on
 * every request the active organization and role are re-read from `Membership`.
 * Removing someone from an organization, or changing their role, therefore takes
 * effect on their very next request rather than whenever their token expires.
 */
export const { handlers, signIn, signOut, auth, unstable_update } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    Credentials({
      credentials: {
        email: {},
        password: {},
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase().trim() },
          include: { memberships: { orderBy: { createdAt: "asc" }, take: 1 } },
        });
        if (!user) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        // A user with no membership belongs to no organization: nothing to sign in to.
        const membership = user.memberships[0];
        if (!membership) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: membership.role,
          organizationId: membership.organizationId,
        };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user, trigger, session }) => {
      if (user) {
        token.role = user.role;
        token.organizationId = user.organizationId;
        return token;
      }
      if (!token.sub) return null;

      // Which organization is wanted: the one in the token, or — on an explicit
      // switch — the requested one. Either way it must be a membership the user holds.
      let wanted = token.organizationId as string | undefined;
      if (trigger === "update") {
        const requested = (session as { organizationId?: unknown } | undefined)?.organizationId;
        if (typeof requested === "string") wanted = requested;
      }
      const membership = await resolveActiveMembership(token.sub, wanted);
      if (!membership) return null; // no access anywhere — the session ends

      token.organizationId = membership.organizationId;
      token.role = membership.role;
      return token;
    },
    session: async ({ session, token }) => {
      if (session.user) {
        session.user.id = token.sub as string;
        session.user.role = token.role as "OWNER" | "STAFF";
        session.user.organizationId = token.organizationId as string;
      }
      return session;
    },
  },
});
