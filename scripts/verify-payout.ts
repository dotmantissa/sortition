import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { db } from "../lib/db";
import {
  chain,
  addresses,
  readFinal,
  object,
  publicReceipt,
  executionSucceeded,
} from "../lib/chain";
import { queueAction } from "../lib/service";
import { workerTick } from "../lib/worker";
import type { TransactionHash } from "genlayer-js/types";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/live-test.json",
  state = JSON.parse(readFileSync(path, "utf8"));
const id = state.question_id,
  owner = {
    id: "sortition:studio:verification",
    beneficiary: chain().account!.address,
  };
const docket = object(await readFinal(state.docket_address, "get_docket"));
const rounds = docket.rounds as {
  outcome: string;
  sources: { value: string; reachable: boolean }[];
}[];
assert.equal(rounds.length, 2);
assert.ok(
  rounds.every(
    (round) =>
      round.outcome === "YES" &&
      round.sources.every(
        (source) => source.reachable && source.value === "200=ok",
      ),
  ),
);
const operations =
  await db()`SELECT tx_hash FROM operations WHERE question_id=${id} AND kind='resolve' AND status='complete' ORDER BY created_at`;
assert.equal(operations.length, 2);
const receipts = [];
for (const [index, op] of operations.entries()) {
  const raw = await chain().getTransaction({
    hash: op.tx_hash as TransactionHash,
  });
  assert.ok(executionSucceeded(raw));
  const receipt = publicReceipt(raw);
  assert.equal(receipt.validators.length + 1, 5 + index * 2);
  assert.ok(
    receipt.validators.some(
      (member) =>
        Array.isArray(member.source_reads) && member.source_reads.length > 0,
    ),
  );
  receipts.push(receipt);
}
state.hearing_receipts = receipts;
writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
const before = BigInt(
  (await readFinal(addresses().vault, "get_credit", [
    owner.beneficiary,
  ])) as string,
);
if (state.withdraw) {
  assert.equal(before, 0n);
  console.log("Stored payout withdrawal verified.");
  process.exit(0);
}
assert.ok(before >= 12n);
const balance = await chain().getBalance({ address: owner.beneficiary });
const queued = await queueAction(
  owner,
  id,
  "withdraw",
  undefined,
  `studio-verification-${id}-withdraw-v1`,
);
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    await workerTick();
  } catch {
    console.log("Transient payout read; checking durable operation again.");
  }
  const rows =
    await db()`SELECT status,tx_hash,error FROM operations WHERE id=${queued.id}`;
  const op = rows[0];
  if (op.status === "complete") {
    assert.equal(
      BigInt(
        (await readFinal(addresses().vault, "get_credit", [
          owner.beneficiary,
        ])) as string,
      ),
      0n,
    );
    assert.ok(
      (await chain().getBalance({ address: owner.beneficiary })) >=
        balance + before,
    );
    state.withdraw = {
      tx_hash: op.tx_hash,
      amount: before.toString(),
      credit_after: "0",
    };
    state.verified = true;
    writeFileSync(path, JSON.stringify(state, null, 2) + "\n");
    console.log("Native payout transfer verified", op.tx_hash);
    break;
  }
  if (["failed", "needs_review"].includes(op.status))
    throw Error("Payout requires review. No duplicate transfer was submitted.");
  await new Promise((resolve) => setTimeout(resolve, 10000));
}
assert.ok(
  state.withdraw,
  "Payout did not complete within the observation period.",
);
