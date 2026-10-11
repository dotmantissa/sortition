import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { db } from "../lib/db";
import {
  chain,
  addresses,
  readFinal,
  object,
  publicReceipt,
  executionSucceeded,
  readTransaction,
  statusName,
} from "../lib/chain";
import { queueAction } from "../lib/service";
import { workerTick } from "../lib/worker";
import type { TransactionHash } from "genlayer-js/types";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/live-test.json",
  state = JSON.parse(readFileSync(path, "utf8"));
function save() {
  writeFileSync(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}
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
save();
const currentCredit = BigInt(
  (await readFinal(addresses().vault, "get_credit", [
    owner.beneficiary,
  ])) as string,
);
if (state.withdraw) {
  assert.equal(currentCredit, 0n);
  console.log("Stored payout withdrawal verified.");
  process.exit(0);
}
const before = BigInt(state.withdrawal_baseline?.credit ?? currentCredit);
assert.ok(before >= 12n);
assert.ok(
  currentCredit === before ||
    (currentCredit === 0n && state.withdrawal_baseline),
);
if (!state.withdrawal_baseline) {
  state.withdrawal_baseline = {
    balance: (
      await chain().getBalance({ address: owner.beneficiary })
    ).toString(),
    credit: before.toString(),
  };
  save();
}
const balance = BigInt(state.withdrawal_baseline.balance);
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
    const children = await chain().getTriggeredTransactionIds({
      hash: op.tx_hash as TransactionHash,
    });
    assert.ok(children.length > 0, "Withdrawal must emit a native payment.");
    const transfers = [];
    for (const hash of children) {
      const child = await readTransaction(hash);
      assert.equal(statusName(child), "FINALIZED");
      assert.ok(
        executionSucceeded(child),
        "Native child payment must succeed.",
      );
      const raw = object(child);
      assert.equal(
        String(raw.to_address || raw.recipient).toLowerCase(),
        owner.beneficiary.toLowerCase(),
      );
      assert.equal(BigInt(String(raw.value)), before);
      transfers.push(publicReceipt(child));
    }

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
      payments: transfers,
    };
    state.verified = true;
    state.native_withdrawal_verified = true;
    save();
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
