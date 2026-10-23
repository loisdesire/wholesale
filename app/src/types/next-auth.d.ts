import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "OWNER" | "STAFF";
      organizationId: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: "OWNER" | "STAFF";
    organizationId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "OWNER" | "STAFF";
    organizationId?: string;
  }
}
