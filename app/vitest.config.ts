import path from "node:path";
import { defineConfig } from "vitest/config";
import { testDatabaseUrl } from "./tests/global-setup";

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
    env: {
      DATABASE_URL: testDatabaseUrl(),
    },
  },
});
