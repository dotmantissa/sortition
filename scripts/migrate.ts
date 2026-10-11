import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
nextEnv.loadEnvConfig(process.cwd());
const sql = db();
try {
  for (const statement of readFileSync("scripts/schema.sql", "utf8")
    .split(";")
    .filter((s) => s.trim()))
    await sql.query(statement);
  console.log("Database schema is ready.");
} catch {
  console.error(
    "Database migration failed. Check connectivity and the private database configuration.",
  );
  process.exitCode = 1;
}
