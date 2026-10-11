/** Verify the deployed service against the real final Studio question. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../lib/db";
import { digest } from "../lib/security";
nextEnv.loadEnvConfig(process.cwd());
const state = JSON.parse(readFileSync("deployments/live-test.json", "utf8"));
assert.ok(
  state.native_withdrawal_verified,
  "Finish the native payment proof first.",
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
const key = "srt_" + randomBytes(32).toString("hex"),
  keyId = randomUUID();
await sql`INSERT INTO api_keys(id,owner_id,key_hash,prefix) VALUES(${keyId},'sortition:studio:verification',${digest(key)},${key.slice(0, 12)})`;
try {
  const headers = { Authorization: `Bearer ${key}` };
  const ownedResponse = await fetch(`${base}/api/questions/${id}`, { headers });
  assert.equal(ownedResponse.status, 200);
  const owned = await ownedResponse.json();
  assert.equal(owned.can_operate, true);
  assert.equal(owned.credit, "0");
  assert.ok(
    owned.operations.some(
      (op: { kind: string; status: string }) =>
        op.kind === "withdraw" && op.status === "complete",
    ),
  );
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
