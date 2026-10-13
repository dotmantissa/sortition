/**
 * Verify the recorded hearings of the primary live question against the panel
 * each round was funded for, and that a losing sponsored bond is forfeited to a
 * treasury the relay cannot spend from.
 *
 * The native payout proof lives in scripts/verify-exit.ts, where the refund
 * path produces withdrawable credit.
 */
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
  panelVerification,
  executionSucceeded,
} from "../lib/chain";
import { BURN_TREASURY } from "../lib/deployment";
import type { TransactionHash } from "genlayer-js/types";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/live-test.json",
  state = JSON.parse(readFileSync(path, "utf8"));
function save() {
  writeFileSync(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}
const id = state.question_id;
const docket = object(await readFinal(state.docket_address, "get_docket"));
const rounds = docket.rounds as {
  outcome: string;
  round: number;
  required_validators: number;
  sources: {
    value: string;
    reachable: boolean;
    quote: string;
    excerpt: string;
    digest: string;
  }[];
}[];
assert.equal(rounds.length, 2);
for (const round of rounds) {
  assert.equal(round.outcome, "YES");
  // Every stored reading carries a quotation that really occurs in the
  // retained window, not an unrelated document prefix.
  for (const source of round.sources) {
    assert.ok(source.reachable && source.value === "200=ok");
    assert.ok(source.quote.length >= 24, "a supporting quotation is retained");
    assert.ok(
      source.excerpt.includes(source.quote),
      "the retained window contains its quotation",
    );
    assert.match(source.digest, /^[a-f0-9]{64}$/);
  }
  assert.equal(round.required_validators, 5 + 2 * (round.round - 1));
}
const operations =
  await db()`SELECT tx_hash FROM operations WHERE question_id=${id} AND kind='resolve' AND status='complete' ORDER BY created_at`;
assert.equal(operations.length, 2);
const receipts = [];
const panels = [];
for (const [index, op] of operations.entries()) {
  const raw = await chain().getTransaction({
    hash: op.tx_hash as TransactionHash,
  });
  assert.ok(executionSucceeded(raw));
  const receipt = publicReceipt(raw);
  const check = panelVerification(receipt, rounds[index].required_validators);
  assert.ok(
    check.verified,
    `round ${index + 1} seated ${check.observed} of ${check.required} with ${check.independent_validators} independent validators`,
  );
  assert.ok(
    receipt.validators.some(
      (member) =>
        Array.isArray(member.source_reads) && member.source_reads.length > 0,
    ),
    "each hearing retains independent participant evidence",
  );
  receipts.push(receipt);
  panels.push({ round: index + 1, ...check });
}
state.hearing_receipts = receipts;
state.panel_checks = panels;
// A sponsored challenge for the losing outcome is a real cost: it leaves the
// relay for an address nobody can spend from.
const relayCredit = BigInt(
  (await readFinal(addresses().vault, "get_credit", [
    chain().account!.address,
  ])) as string,
);
const treasuryCredit = BigInt(
  (await readFinal(addresses().vault, "get_credit", [BURN_TREASURY])) as string,
);
assert.equal(relayCredit, 0n);
assert.ok(treasuryCredit >= 12n);
state.relay_credit = relayCredit.toString();
state.treasury_credit = treasuryCredit.toString();
state.treasury = BURN_TREASURY;
state.verified = true;
save();
console.log(
  "Hearing panels, retained quotations and treasury forfeiture verified.",
);
