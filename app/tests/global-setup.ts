import { execSync } from "node:child_process";
import path from "node:path";
import { loadEnv } from "vite";

const APP_ROOT = path.resolve(__dirname, "..");

/** Resolves the throwaway test database URL, refusing anything that could be the dev database. */
export function testDatabaseUrl() {
  const env = loadEnv("test", APP_ROOT, "");
  const url = process.env.TEST_DATABASE_URL ?? env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set — see .env.example (database name must end in _test).");
  }
  const dbName = new URL(url).pathname.replace(/^\//, "");
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${dbName}": the test database name must end in "_test".`);
  }
  return url;
}

export default function setup() {
  const env = { ...process.env, DATABASE_URL: testDatabaseUrl() };
  // Start every run from an empty schema, then apply the real migrations (so
  // they're exercised too). Safe only because testDatabaseUrl() has verified
  // this is a "_test" database.
  execSync("npx prisma db execute --stdin --schema prisma/schema.prisma", {
    cwd: APP_ROOT,
    env,
    input: "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;",
    stdio: ["pipe", "inherit", "inherit"],
  });
  execSync("npx prisma migrate deploy", { cwd: APP_ROOT, env, stdio: "inherit" });
}
