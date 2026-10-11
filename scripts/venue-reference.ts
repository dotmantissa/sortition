import nextEnv from "@next/env";
import { randomBytes, randomUUID } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { db } from "../lib/db";
import { digest } from "../lib/security";
import { chain, networkClock } from "../lib/chain";
import {
  importPolymarket,
  registerPolymarketQuestion,
} from "../integrations/polymarket";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/polymarket-reference.json";
if (existsSync(path)) {
  console.log(
    "Reference already registered",
    JSON.parse(readFileSync(path, "utf8")).question_id,
  );
  process.exit(0);
}
const slug = process.argv[2] || "nfl-sf-sea-2026-10-11-spread-away-4pt5";
const market = await importPolymarket(slug);
const close = Math.floor(new Date(market.endDate).getTime() / 1000);
if (close <= (await networkClock()).unix + 600)
  throw Error(
    "Choose a real venue market with sufficient time before its close.",
  );
const owner = "sortition:studio:verification";
const sql = db();
await sql`INSERT INTO operators(id,beneficiary) VALUES(${owner},${chain().account!.address}) ON CONFLICT(id) DO NOTHING`;
const key = "srt_" + randomBytes(32).toString("hex"),
  keyId = randomUUID();
await sql`INSERT INTO api_keys(id,owner_id,key_hash,prefix) VALUES(${keyId},${owner},${digest(key)},${key.slice(0, 12)})`;
process.env.SORTITION_API_KEY = key;
process.env.SORTITION_URL = "https://sortition.vercel.app";
try {
  const registered = await registerPolymarketQuestion({
    slug,
    sources: [
      { name: "NFL official scores", url: market.resolutionSource },
      {
        name: "ESPN NFL scoreboard",
        url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=20261011",
      },
    ],
    unresolvableDefinition:
      "The game has not ended, is cancelled without a make up game, requires a split payout, or either registered source is unavailable or does not identify the final score for this game.",
    closeTimestamp: close,
    disagreementRule: "unanimous",
    tieBreakUrl: market.resolutionSource,
  });
  writeFileSync(
    path,
    JSON.stringify(
      {
        venue: "Polymarket",
        venue_market_id: market.id,
        venue_slug: slug,
        question: market.question,
        venue_outcomes: market.outcomes,
        criteria: market.description,
        question_id: registered.id,
        operation_id: registered.operation_id,
        registered_at: new Date().toISOString(),
        note: "Independent Sortition reference docket. Polymarket retains its own resolver.",
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Real venue reference registered:", registered.id);
} finally {
  await sql`UPDATE api_keys SET revoked_at=now() WHERE id=${keyId}`;
  delete process.env.SORTITION_API_KEY;
}
