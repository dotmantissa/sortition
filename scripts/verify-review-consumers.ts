/* eslint-disable @typescript-eslint/no-explicit-any -- Persisted network evidence is validated before use. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { db } from "../lib/db";
import { encrypt } from "../lib/security";
import { consumeFinalSettlement } from "../integrations/polymarket";
import { verifyAttestation } from "../lib/attestation";
nextEnv.loadEnvConfig(process.cwd());
process.env.SORTITION_URL = "https://sortition.vercel.app";
const base = process.env.SORTITION_URL;
const s = JSON.parse(readFileSync("deployments/reviewer-v9.json", "utf8"));
const p = JSON.parse(readFileSync(".vercel/reviewer-actors.json", "utf8"));
p.webhook_secret ??= randomBytes(32).toString("hex");
writeFileSync(".vercel/reviewer-actors.json", JSON.stringify(p), {
  mode: 0o600,
});
const sql = db();
s.consumer_checks = {};
for (const kind of [
  "event",
  "historical",
  "incomplete",
  "undersized",
  "native",
]) {
  const e = s.cases[kind];
  const pin = {
    questionId: e.id,
    criteriaHash: e.criteria_hash,
    docketAddress: e.docket,
    network: "studionet",
  };
  const c = await consumeFinalSettlement(pin);
  assert.ok(c);
  assert.equal(c.venueAction, kind === "event" ? "pay_yes" : "refund");
  const a = await (
    await fetch(`${base}/api/questions/${e.id}/settlement?attest=true`)
  ).json();
  assert.ok(
    await verifyAttestation(a.attestation, {
      signer: s.actors.relay,
      settlement: a,
      now: Number(
        (
          await sql`SELECT floor(extract(epoch from now()))::bigint AS timestamp`
        )[0].timestamp,
      ),
    }),
  );
  await sql`INSERT INTO reference_receivers(question_id,venue,market_id,criteria_hash,docket_address,network,secret_ciphertext) VALUES(${e.id},'Synthetic reviewer fixtures',${kind},${e.criteria_hash},${e.docket},'studionet',${encrypt(p.webhook_secret)}) ON CONFLICT(question_id) DO NOTHING`;
  const event = {
    type: "question.settled",
    question_id: e.id,
    outcome: a.outcome,
    refunded: a.refunded,
    criteria_hash: e.criteria_hash,
    docket_address: e.docket,
    round: a.rounds,
    network: "studionet",
    panel_verified: a.panel_verified,
  };
  const body = JSON.stringify(event),
    id = randomUUID(),
    time = String(
      (
        await sql`SELECT floor(extract(epoch from now()))::bigint AS timestamp`
      )[0].timestamp,
    );
  const sig = createHmac("sha256", p.webhook_secret)
    .update(`${time}.${id}.${body}`)
    .digest("hex");
  const headers = {
    "Content-Type": "application/json",
    "Sortition-Event-Id": id,
    "Sortition-Signature": `t=${time},v1=${sig}`,
  };
  const delivered = await fetch(base + "/api/reference/settlement", {
    method: "POST",
    headers,
    body,
  });
  assert.equal(delivered.status, 200);
  const decision = await delivered.json();
  assert.equal(decision.action, c.venueAction);
  const replay = await (
    await fetch(base + "/api/reference/settlement", {
      method: "POST",
      headers,
      body,
    })
  ).json();
  assert.equal(replay.duplicate, true);
  const tamper = await fetch(base + "/api/reference/settlement", {
    method: "POST",
    headers: { ...headers, "Sortition-Event-Id": randomUUID() },
    body,
  });
  assert.equal(tamper.status, 401);
  s.consumer_checks[kind] = {
    adapter_action: c.venueAction,
    attestation_verified: true,
    signature_delivery: decision,
    replay,
    tampered_event_id_status: tamper.status,
    ledger: await (
      await fetch(`${base}/api/reference/settlement?question_id=${e.id}`)
    ).json(),
  };
}
s.native_appeal_evidence_notice =
  "The late direct native submission returned the original transaction ID; the recorded receipt has no new completed appeal-validation evidence. The earlier failed rollback receipt is preserved in deployments/native-appeal-attempt.json. Missing-docket recovery is behaviorally tested; this v9 vault actually refunded the native-case fee after its permissionless deadline.";
writeFileSync(
  "deployments/reviewer-v9.json",
  JSON.stringify(s, null, 2) + "\n",
);
console.log(
  "Five pinned adapters, signed attestations, independent chain-backed reference decisions, duplicate and tamper checks verified.",
);
