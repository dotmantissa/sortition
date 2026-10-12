import nextEnv from "@next/env";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import {
  registerPolymarketQuestion,
  consumeFinalSettlement,
  importPolymarket,
} from "../integrations/polymarket.ts";
import { networkClock, addresses, readFinal, object } from "../lib/chain.ts";
import { db } from "../lib/db.ts";
import { encrypt } from "../lib/security.ts";
import { workerTick } from "../lib/worker.ts";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/polymarket-consumer.json",
  state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
if (state.verified) {
  console.log(
    "Already verified. The saved venue settlement and signed consumer proof remain available.",
  );
  process.exit(0);
}
const secret = JSON.parse(
  readFileSync(".vercel/remediation-verification-private.json", "utf8"),
);
process.env.SORTITION_URL = "https://sortition.vercel.app";
process.env.SORTITION_API_KEY = secret.keys.operator;
const base = process.env.SORTITION_URL,
  sql = db();
const save = () => {
  writeFileSync(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(path + ".tmp", path);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slug = "nfl-sf-sea-2026-10-11-spread-away-4pt5";
async function wait(id) {
  for (let i = 0; i < 240; i++) {
    await workerTick();
    const op = (
      await sql`SELECT status,tx_hash,error FROM operations WHERE id=${id}`
    )[0];
    if (op.status === "complete") return op;
    if (["failed", "needs_review"].includes(op.status)) throw Error(op.error);
    await sleep(10000);
  }
  throw Error("Resume the saved venue operation.");
}
async function action(kind) {
  state.operations ??= {};
  if (state.operations[kind]) return state.operations[kind];
  const r = await fetch(
    base + "/api/questions/" + state.question_id + "/actions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + secret.keys.operator,
        "Content-Type": "application/json",
        "Idempotency-Key": "venue-v7:" + state.question_id + ":" + kind,
      },
      body: JSON.stringify({ action: kind }),
    },
  );
  const b = await r.json();
  if (!r.ok) throw Error("Venue action failed: " + b.error);
  state.operations[kind] = b.id;
  save();
  return b.id;
}
if (!state.question_id) {
  const market = await importPolymarket(slug);
  state.venue = "Polymarket";
  state.market_id = String(market.id);
  state.slug = slug;
  state.question = market.question;
  state.venue_outcomes = market.outcomes;
  save();
  const q = await registerPolymarketQuestion({
    slug,
    sources: [
      {
        name: "ESPN final game scoreboard",
        url: "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard/401872992",
      },
      {
        name: "ESPN core competition record",
        url: "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/events/401872992/competitions/401872992?lang=en&region=us",
      },
    ],
    unresolvableDefinition:
      "UNRESOLVABLE if any registered source does not itself include the completed final game status, both team identities and their numeric final scores. Never follow references to unregistered URLs. A source containing only score reference links cannot supply this evidence.",
    closeTimestamp: (await networkClock()).unix + 180,
    disagreementRule: "unanimous",
    tieBreakUrl:
      "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard/401872992",
    idempotencyKey: "venue-v7-locked-reference",
    webhook: {
      url: base + "/api/reference/settlement",
      secret: secret.webhook_secret,
    },
  });
  state.question_id = q.id;
  state.operations = { register: q.operation_id };
  save();
  console.log("Real venue question registered", q.id);
}
await wait(state.operations.register);
const q = object(
  await readFinal(addresses().registry, "get_question", [state.question_id]),
);
state.criteria_hash = q.criteria_hash;
state.docket_address = q.docket_address;
state.specification = q.specification;
save();
await sql`INSERT INTO reference_receivers(question_id,venue,market_id,criteria_hash,docket_address,network,secret_ciphertext) VALUES(${state.question_id},'Polymarket',${state.market_id},${state.criteria_hash},${state.docket_address},'studionet',${encrypt(secret.webhook_secret)}) ON CONFLICT(question_id) DO NOTHING`;
while ((await networkClock()).unix < q.specification.close_timestamp)
  await sleep(10000);
await wait(await action("resolve"));
const d = object(await readFinal(state.docket_address, "get_docket"));
assert.equal(d.rounds.at(-1).outcome, "UNRESOLVABLE");
state.ruling = d.rounds.at(-1);
state.note =
  "Two real ESPN data endpoints are registered. The core record supplies score references rather than final score values. The locked uncertainty rule therefore requires UNRESOLVABLE. This proves the independent reference consumer refund path; it does not alter Polymarket settlement and does not claim independent publishers.";
save();
const a = object(
  await readFinal(addresses().vault, "get_account", [state.question_id]),
);
state.deadline = a.round_deadline;
save();
console.log(
  "Verified real venue UNRESOLVABLE; awaiting window",
  state.deadline,
);
while ((await networkClock()).unix < state.deadline + 5) await sleep(30000);
await wait(await action("finalize"));
const pin = {
  questionId: state.question_id,
  criteriaHash: state.criteria_hash,
  docketAddress: state.docket_address,
  network: "studionet",
};
const consumed = await consumeFinalSettlement(pin);
assert.equal(consumed.venueAction, "refund");
assert.equal(consumed.settlement.final, true);
state.consumer = consumed;
for (let i = 0; i < 60; i++) {
  await workerTick();
  const r = await fetch(
    base + "/api/reference/settlement?question_id=" + state.question_id,
  );
  if (r.ok) {
    state.signed_consumer = await r.json();
    break;
  }
  await sleep(10000);
}
assert.equal(state.signed_consumer.action, "refund");
assert.equal(state.signed_consumer.venue, "Polymarket");
assert.equal(state.signed_consumer.market_id, state.market_id);
state.verified = true;
state.verified_at = new Date().toISOString();
save();
console.log(
  "PASS: actual imported venue question, locked missing evidence, finalized refund mapping and signed reference consumer.",
);
