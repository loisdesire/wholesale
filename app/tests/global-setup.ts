import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";

const APP_ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(APP_ROOT, "prisma/test.db");
const DATABASE_URL = "file:./test.db?connection_limit=1";

export default function setup() {
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    const file = DB_PATH + suffix;
    if (existsSync(file)) unlinkSync(file);
  }

  execSync("npx prisma migrate deploy", {
    cwd: APP_ROOT,
    env: { ...process.env, DATABASE_URL },
    stdio: "inherit",
  });
}
