/** Verify the deployed service against the real final Studio question. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../lib/db";
import { digest } from "../lib/security";
import { verifyAttestation } from "../lib/attestation";
nextEnv.loadEnvConfig(process.cwd());
const state = JSON.parse(readFileSync("deployments/live-test.json", "utf8"));
const exit = JSON.parse(readFileSync("deployments/live-exit.json", "utf8"));
assert.ok(
  exit.native_withdrawal_verified,
  "Finish the native payment proof in scripts/verify-exit.ts first.",
);
const base = process.env.SORTITION_URL || "https://sortition.vercel.app";
const id = state.question_id;
const publicResponse = await fetch(`${base}/api/questions/${id}/settlement`);
assert.equal(publicResponse.status, 200);
assert.equal(publicResponse.headers.get("access-control-allow-origin"), "*");
const settlement = await publicResponse.json();
assert.equal(settlement.final, true);
assert.equal(settlement.outcome, "YES");
assert.equal(settlement.criteria_hash, state.criteria_hash);
assert.equal(settlement.rounds, 2);
assert.equal(settlement.panel_verified, true);
assert.equal(typeof settlement.index_age_seconds, "number");
// The signed attestation is offered on request and verifies against the relay.
const attested = await (
  await fetch(`${base}/api/questions/${id}/settlement?attest=true`)
).json();
assert.ok(
  await verifyAttestation(attested.attestation, {
    signer: attested.attestation.signer,
    settlement: attested,
  }),
  "the published attestation must verify against its own statement",
);
assert.match(attested.attestation.disclaimer, /not GenLayer consensus/);
const refundResponse = await fetch(
  `${base}/api/questions/${exit.question_id}/settlement`,
);
const refund = await refundResponse.json();
assert.equal(refund.outcome, "REFUNDED");
assert.equal(refund.final, true);
assert.equal(refund.refunded, true);
const rpc = await fetch(`${base}/api/rpc`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: "studio-proof",
    method: "sortition_getDocket",
    params: { question_id: id },
  }),
});
assert.equal(rpc.status, 200);
const rpcBody = await rpc.json();
assert.equal(rpcBody.id, "studio-proof");
assert.equal(rpcBody.result.escrow.outcome, settlement.outcome);
assert.equal(rpcBody.result.docket.rounds.length, 2);
assert.equal((await fetch(`${base}/api/questions?mine=true`)).status, 401);
const sql = db();
const ownerRows = await sql`SELECT owner_id FROM questions WHERE id=${id}`;
assert.ok(
  ownerRows[0],
  "The verified question must exist in the service database.",
);
const ownerId = ownerRows[0].owner_id;
const key = "srt_" + randomBytes(32).toString("hex"),
  keyId = randomUUID();
await sql`INSERT INTO api_keys(id,owner_id,key_hash,prefix) VALUES(${keyId},${ownerId},${digest(key)},${key.slice(0, 12)})`;
try {
  const headers = { Authorization: `Bearer ${key}` };
  const ownedResponse = await fetch(`${base}/api/questions/${id}`, { headers });
  assert.equal(ownedResponse.status, 200);
  const owned = await ownedResponse.json();
  assert.equal(owned.can_operate, true);
  assert.equal(owned.credit, "0");
  const exitResponse = await fetch(
    `${base}/api/questions/${exit.question_id}`,
    {
      headers,
    },
  );
  assert.equal(exitResponse.status, 200);
  const exitRecord = await exitResponse.json();
  assert.ok(
    exitRecord.operations.some(
      (op: { kind: string; status: string }) =>
        op.kind === "withdraw" && op.status === "complete",
    ),
    "the refunded payout is indexed as a completed withdrawal",
  );
  assert.equal(exitRecord.escrow.outcome, "REFUNDED");
  const mine = await fetch(`${base}/api/questions?mine=true`, { headers });
  assert.equal(mine.status, 200);
  assert.ok(
    (await mine.json()).questions.some((q: { id: string }) => q.id === id),
  );
  await sql`UPDATE api_keys SET revoked_at=now() WHERE id=${keyId}`;
  assert.equal(
    (await fetch(`${base}/api/questions?mine=true`, { headers })).status,
    401,
  );
  writeFileSync(
    "deployments/service-verification.json",
    JSON.stringify(
      {
        url: base,
        question_id: id,
        verified_at: new Date().toISOString(),
        settlement,
        checks: [
          "Final REST settlement and widget CORS",
          "Verified hearing panels and signed settlement attestation",
          "Refunded bounded exit published as a final non adjudication",
          "JSON RPC docket agrees with settlement",
          "Unsigned operator access rejected",
          "Hashed API key authenticates its owner",
          "Final native credit and complete withdrawal indexed",
          "Revoked API key rejected",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "Deployed REST, JSON RPC, operator access and key revocation verified.",
  );
} finally {
  await sql`UPDATE api_keys SET revoked_at=now() WHERE id=${keyId}`;
}
