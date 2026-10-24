import path from "node:path";
import { defineConfig } from "vitest/config";
import { testAppDatabaseUrl, testDatabaseUrl } from "./tests/global-setup";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    globalSetup: ["./tests/global-setup.ts"],
    // All test files share one Postgres test database (wiped and re-migrated by
    // global-setup). Test files run one after another so they don't race on it.
    fileParallelism: false,
    // The default 5s per-test timeout is tight for DB-heavy integration tests once there's any
    // added I/O latency (a slower disk, Docker Desktop's VM layer, or just a loaded machine) —
    // headroom here, not a mask for a real bug: a genuinely hung test still fails at 10s.
    testTimeout: 10_000,
    env: {
      // Fixtures and the root client: the database owner.
      DATABASE_URL: testDatabaseUrl(),
      DIRECT_URL: testDatabaseUrl(),
      // The code under test: the restricted role, so row-level security is enforced.
      TENANT_DATABASE_URL: testAppDatabaseUrl(),
    },
  },
});
