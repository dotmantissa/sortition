import nextEnv from "@next/env";
import { readFileSync } from "node:fs";
import { db } from "../lib/db";
import { addresses } from "../lib/chain";
nextEnv.loadEnvConfig(process.cwd());
const sql = db();
try {
  for (const statement of readFileSync("scripts/schema.sql", "utf8")
    .split(";")
    .filter((s) => s.trim()))
    await sql.query(statement);
  const contracts = addresses();
  await sql`UPDATE questions SET registry_address=COALESCE(registry_address,${contracts.registry}),vault_address=COALESCE(vault_address,${contracts.vault}) WHERE registry_address IS NULL OR vault_address IS NULL`;
  console.log("Database schema is ready.");
} catch {
  console.error(
    "Database migration failed. Check connectivity and the private database configuration.",
  );
  process.exitCode = 1;
}
