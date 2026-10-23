import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // All test files share one SQLite file (recreated fresh by global-setup).
    // SQLite allows only one writer at a time, so run test files one after
    // another rather than racing them across worker processes.
    fileParallelism: false,
    // Points at a throwaway SQLite file, recreated fresh by global-setup on
    // every run — never the dev database with its seeded demo data. Resolved
    // relative to prisma/schema.prisma (where "file:./dev.db" in .env also
    // resolves), so this lands at prisma/test.db.
    env: {
      DATABASE_URL: "file:./test.db?connection_limit=1",
    },
  },
});
