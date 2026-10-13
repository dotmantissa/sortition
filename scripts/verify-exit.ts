/**
 * Prove the bounded exit on the real network: a funded hearing that never
 * produces a ruling is released permissionlessly, every payer is refunded, and
 * the refund is actually delivered as native value.
 *
 * Resumable. It never resends a stored operation.
 */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { db } from "../lib/db";
import {
  chain,
  networkClock,
  addresses,
  readFinal,
  object,
  publicReceipt,
  statusName,
  executionSucceeded,
  readTransaction,
} from "../lib/chain";
import { timeoutClaimable } from "../lib/lifecycle";
import { registerQuestion, queueAction } from "../lib/service";
import { workerTick } from "../lib/worker";
import type { TransactionHash } from "genlayer-js/types";
nextEnv.loadEnvConfig(process.cwd());
const statePath = "deployments/live-exit.json";
const state: Record<string, unknown> = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
function save() {
  writeFileSync(statePath + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(statePath + ".tmp", statePath);
}
const account = chain().account!;
const owner = {
  id: "sortition:studio:verification",
  beneficiary: account.address,
};
await db()`INSERT INTO operators(id,beneficiary) VALUES(${owner.id},${owner.beneficiary}) ON CONFLICT(id) DO NOTHING`;
if (!state.question_id) {
  // A question whose sources are real but whose hearing is deliberately never
  // requested, so the only way out is the deadline.
  const created = await registerQuestion(
    owner,
    {
      specification: {
        question:
          "Does the IANA HTTP status registry list code 418 as a teapot code?",
        criteria:
          "For each source independently return YES if that source lists code 418, NO if it states the code is unassigned, and UNKNOWN if absent. Extract the canonical value 418=listed or 418=absent. This question exists to exercise the funded hearing deadline and is deliberately never heard.",
        sources: [
          {
            name: "IANA HTTP Status Code Registry",
            url: "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
          },
          {
            name: "MDN official status 418 documentation",
            url: "https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/status/418/index.md",
          },
        ],
        tie_break_url:
          "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
        disagreement_rule: "unanimous",
        close_timestamp: (await networkClock()).unix + 120,
        unresolvable_definition:
          "A source cannot be reached or does not describe code 418.",
      },
      fee: "7",
      base_bond: "2",
    },
    "studio-exit-registration-v8",
  );
  state.question_id = created.id;
  save();
  console.log("Registered the deadline question", created.id);
}
const id = state.question_id as string;
async function waitForOperation(kind: string, opId?: string) {
  for (let i = 0; i < 180; i++) {
    try {
      await workerTick();
    } catch {
      console.log("Transient service read; the durable operation stands.");
    }
    const rows = opId
      ? await db()`SELECT * FROM operations WHERE id=${opId}`
      : await db()`SELECT * FROM operations WHERE question_id=${id} AND kind=${kind} ORDER BY created_at DESC LIMIT 1`;
    const op = rows[0];
    if (op?.status === "complete") {
      console.log("Verified operation", kind, op.tx_hash);
      return op;
    }
    if (op && ["failed", "needs_review"].includes(op.status))
      throw Error(`${kind}: ${op.error}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw Error(`Timed out: ${kind}`);
}
/** The worker queues the release itself once a hearing is overdue. Adopt that
 * operation rather than competing with it. */
async function releaseOperation() {
  const existing =
    await db()`SELECT id FROM operations WHERE question_id=${id} AND kind='claim_timeout' AND status<>'failed' ORDER BY created_at LIMIT 1`;
  if (existing[0]) {
    console.log("Adopting the service queued release", existing[0].id);
    return existing[0].id as string;
  }
  return (
    await queueAction(
      owner,
      id,
      "claim_timeout",
      undefined,
      `studio-exit-${id}-timeout-v1`,
    )
  ).id as string;
}
await waitForOperation("register");
const registered = object(
  await readFinal(addresses().registry, "get_question", [id]),
);
state.docket_address = registered.docket_address;
state.criteria_hash = registered.criteria_hash;
save();
if (!state.fund) {
  const queued = await queueAction(
    owner,
    id,
    "fund",
    undefined,
    `studio-exit-${id}-fund-v1`,
  );
  const op = await waitForOperation("fund", queued.id);
  state.fund = { tx_hash: op.tx_hash };
  save();
}
const funded = object(await readFinal(addresses().vault, "get_account", [id]));
assert.equal(funded.funded, true);
assert.equal(
  String(funded.fee_payer).toLowerCase(),
  account.address.toLowerCase(),
);
state.fee = state.fee ?? String(funded.fee);
save();
// A resumed run skips straight to the recorded refund.
if (!funded.settled) {
  const deadline = Number(funded.hearing_deadline);
  assert.ok(deadline > 0, "a funded hearing must carry a deadline");
  state.hearing_deadline = deadline;
  save();
  console.log("Fee funded by", funded.fee_payer, "deadline", deadline);
  // No hearing is ever requested for this question. Wait out the deadline.
  for (;;) {
    const now = (await networkClock()).unix;
    if (now >= deadline + 5) break;
    console.log(`Waiting ${deadline - now}s for the funded hearing deadline`);
    await new Promise((r) => setTimeout(r, 30000));
  }
  const overdue = object(
    await readFinal(addresses().vault, "get_account", [id]),
  );
  assert.ok(
    timeoutClaimable(overdue, (await networkClock()).unix),
    "the hearing must be releasable once its deadline passes",
  );
  const op = await waitForOperation("claim_timeout", await releaseOperation());
  state.claim_timeout = { tx_hash: op.tx_hash, operation_id: op.id };
  save();
}
const released = object(
  await readFinal(addresses().vault, "get_account", [id]),
);
assert.equal(released.settled, true);
assert.equal(released.refunded, true);
assert.equal(released.outcome, "REFUNDED");
const refund = BigInt(
  (await readFinal(addresses().vault, "get_credit", [
    owner.beneficiary,
  ])) as string,
);
const docket = object(
  await readFinal(state.docket_address as `0x${string}`, "get_docket"),
);
assert.equal(docket.settled, true, "the docket is locked after a refund");
assert.equal(
  (docket.rounds as unknown[]).length,
  0,
  "no verdict was adjudicated",
);
state.refund_credit = refund.toString();
save();
console.log("Hearing released and refunded", refund.toString(), "GEN wei");
if (!state.withdraw) {
  const expected = refund > 0n ? refund : BigInt(String(state.refunded_amount));
  assert.equal(expected, BigInt(state.fee as string), "the exact fee returns");
  const baseline =
    (state.withdrawal_baseline as string | undefined) ??
    (await chain().getBalance({ address: owner.beneficiary })).toString();
  state.withdrawal_baseline = baseline;
  state.refunded_amount = expected.toString();
  save();
  const queued = await queueAction(
    owner,
    id,
    "withdraw",
    undefined,
    `studio-exit-${id}-withdraw-v1`,
  );
  const op = await waitForOperation("withdraw", queued.id);
  const children = await chain().getTriggeredTransactionIds({
    hash: op.tx_hash as TransactionHash,
  });
  assert.ok(children.length > 0, "a withdrawal must emit a native payment");
  const transfers = [];
  for (const hash of children) {
    const child = await readTransaction(hash);
    assert.equal(statusName(child), "FINALIZED");
    assert.ok(executionSucceeded(child), "the native payment must succeed");
    const raw = object(child);
    assert.equal(
      String(raw.to_address || raw.recipient).toLowerCase(),
      owner.beneficiary.toLowerCase(),
    );
    assert.equal(BigInt(String(raw.value)), expected);
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
      BigInt(baseline) + expected,
    "the refunded value must actually arrive in the wallet",
  );
  state.withdraw = {
    tx_hash: op.tx_hash,
    amount: expected.toString(),
    payments: transfers,
  };
  save();
  console.log("Refund delivered as native value", op.tx_hash);
}
// The beneficiary confirms delivery itself, with no relay involvement.
const payment = object(
  await readFinal(addresses().vault, "get_payment", [owner.beneficiary]),
);
if (payment.status === "pending") {
  const queued = await queueAction(
    owner,
    id,
    "confirm_payment",
    undefined,
    `studio-exit-${id}-confirm-v1`,
  );
  await waitForOperation("confirm_payment", queued.id);
}
const confirmed = object(
  await readFinal(addresses().vault, "get_payment", [owner.beneficiary]),
);
assert.equal(confirmed.status, "delivered");
state.payment = confirmed;
state.verified = true;
state.native_withdrawal_verified = true;
save();
console.log(
  "Bounded exit verified: deadline, permissionless release, exact refund, native delivery and self confirmation.",
);
