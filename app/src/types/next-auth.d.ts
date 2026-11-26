import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "OWNER" | "STAFF";
      organizationId: string;
      isPlatformAdmin: boolean;
    } & DefaultSession["user"];
    /** Id of this sign-in, used to end it on sign-out. */
    sid?: string;
  }

  interface User {
    role: "OWNER" | "STAFF";
    organizationId: string;
    isPlatformAdmin: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "OWNER" | "STAFF";
    organizationId?: string;
    isPlatformAdmin?: boolean;
    sid?: string;
  }
}
