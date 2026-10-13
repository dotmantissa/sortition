/** Real Studio contract and backend integration, never substitutes chain data. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync, renameSync } from "node:fs";
import { createHash } from "node:crypto";
import { db } from "../lib/db";
import {
  chain,
  networkClock,
  addresses,
  readFinal,
  object,
  executionSucceeded,
  publicReceipt,
  statusName,
} from "../lib/chain";
import type { TransactionHash } from "genlayer-js/types";
import { panelVerification } from "../lib/chain";
import { registerQuestion, queueAction } from "../lib/service";
import { BURN_TREASURY } from "../lib/deployment";
import { workerTick } from "../lib/worker";
nextEnv.loadEnvConfig(process.cwd());
const statePath = "deployments/live-test.json";
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
  const spec = {
    question: "Does the IANA HTTP registry list status code 200 as OK?",
    criteria:
      "For each source independently, return YES if that source identifies HTTP status code 200 as OK. Return NO if that source identifies code 200 with a different final meaning. Return UNKNOWN if absent. Extract the canonical value 200=ok for OK, 200=other for a different meaning, or unknown if absent. The contract applies unanimity separately. Only the published description matters.",
    sources: [
      {
        name: "IANA HTTP Status Code Registry",
        url: "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
      },
      {
        name: "MDN official status 200 documentation",
        url: "https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/status/200/index.md",
      },
    ],
    tie_break_url:
      "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
    disagreement_rule: "unanimous",
    close_timestamp: (await networkClock()).unix + 180,
    unresolvable_definition:
      "A source cannot be reached or does not identify code 200. Disagreement between the independently extracted positions is handled by the locked unanimity rule.",
  };
  const created = await registerQuestion(
    owner,
    { specification: spec, fee: "10", base_bond: "2" },
    "studio-verification-registration-v8",
  );
  state.question_id = created.id;
  save();
  console.log("Registered real evidence question", created.id);
}
const id = state.question_id as string;
async function waitForOperation(kind: string, opId?: string) {
  for (let i = 0; i < 120; i++) {
    try {
      await workerTick();
    } catch {
      console.log(
        "Transient service read failed; durable operation will be checked again.",
      );
      await new Promise((r) => setTimeout(r, 10000));
      continue;
    }
    const rows =
      await db()`SELECT * FROM operations WHERE question_id=${id} AND kind=${kind} ORDER BY created_at DESC LIMIT 1`;
    const op = rows[0];
    if (opId) assert.equal(op.id, opId);
    if (op?.status === "complete") {
      console.log("Verified operation", kind, op.tx_hash);
      return op;
    }
    if (op && ["failed", "needs_review"].includes(op.status))
      throw new Error(`${kind}: ${op.error}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error(`Timed out: ${kind}`);
}
await waitForOperation("register");
const registered = object(
  await readFinal(addresses().registry, "get_question", [id]),
);
assert.ok(registered.docket_address);
const actualSpec = registered.specification;
function escrowRounds(docket: Record<string, unknown>) {
  return Array.isArray(docket.rounds) ? docket.rounds.length : 0;
}
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const o = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
      .join(",") +
    "}"
  );
}
assert.equal(
  registered.criteria_hash,
  createHash("sha256").update(canonical(actualSpec)).digest("hex"),
);
state.docket_address = registered.docket_address;
state.criteria_hash = registered.criteria_hash;
save();
for (const kind of ["fund", "resolve", "challenge", "finalize"] as const) {
  if (state[kind]) continue;
  if (kind === "resolve") {
    const close = (actualSpec as { close_timestamp: number }).close_timestamp;
    while ((await networkClock()).unix < close) {
      console.log("Waiting for registered close");
      await new Promise((r) => setTimeout(r, 10000));
    }
  }
  if (kind === "finalize") {
    await waitForOperation("resolve");
    for (;;) {
      const escrow = object(
        await readFinal(addresses().vault, "get_account", [id]),
      );
      if (
        Number(escrow.opened_round) === Number(escrow.challenge_count) + 1 &&
        (await networkClock()).unix >= Number(escrow.round_deadline) + 5
      )
        break;
      console.log("Waiting for bonded appeal window");
      await new Promise((r) => setTimeout(r, 30000));
    }
  }
  const queued = await queueAction(
    owner,
    id,
    kind,
    kind === "challenge" ? "NO" : undefined,
    `studio-verification-${id}-${kind}-v1`,
  );
  const op = await waitForOperation(kind, queued.id);
  state[kind] = { tx_hash: op.tx_hash };
  save();
  if (kind === "resolve") {
    const docket = object(
      await readFinal(state.docket_address as `0x${string}`, "get_docket"),
    );
    const rounds = docket.rounds as {
      outcome: string;
      sources: { value: string; reachable: boolean }[];
    }[];
    assert.equal(rounds.at(-1)?.outcome, "YES");
    assert.equal(rounds.at(-1)?.sources.length, 2);
    assert.ok(
      rounds.at(-1)?.sources.every((s) => s.reachable && s.value === "200=ok"),
    );
    const receipt = await chain().getTransaction({
      hash: op.tx_hash as TransactionHash,
    });
    assert.ok(executionSucceeded(receipt));
    // The panel is checked against the requirement the contract itself
    // committed to when this round was funded, not against a local constant.
    const round = (rounds.at(-1) || {}) as { required_validators?: number };
    const committed = Number(round.required_validators || 0);
    assert.equal(committed, 5 + 2 * Number(escrowRounds(docket) - 1));
    const check = panelVerification(publicReceipt(receipt), committed);
    assert.ok(
      check.verified,
      `hearing seated ${check.observed} of ${committed} with ${check.independent_validators} independent validators`,
    );
    const receipts = Array.isArray(state.hearing_panels)
      ? (state.hearing_panels as unknown[])
      : [];
    receipts.push({ round: committed && rounds.length, ...check });
    state.hearing_panels = receipts;
    state.resolution_receipt = publicReceipt(receipt);
    save();
    console.log(
      "Independent evidence consensus verified:",
      statusName(receipt),
    );
  }
}
const escrow = object(await readFinal(addresses().vault, "get_account", [id]));
assert.equal(escrow.settled, true);
assert.equal(escrow.refunded, false);
assert.equal(escrow.outcome, "YES");
assert.equal(escrow.challenge_count, 1);
// The challenge argued for the losing outcome. Its bond and the resolution fee
// are forfeited to a treasury the relay cannot spend from, so sponsoring a
// losing challenge is a real cost rather than a round trip.
const relayCredit = BigInt(
  (await readFinal(addresses().vault, "get_credit", [
    owner.beneficiary,
  ])) as string,
);
assert.equal(relayCredit, 0n, "a losing sponsored bond must not return");
const forfeited = BigInt(
  (await readFinal(addresses().vault, "get_credit", [BURN_TREASURY])) as string,
);
assert.ok(forfeited >= 12n, "the bond and fee are forfeited to the treasury");
state.verified = true;
state.final_outcome = escrow.outcome;
state.relay_credit = relayCredit.toString();
state.treasury_credit = forfeited.toString();
state.treasury = BURN_TREASURY;
save();
console.log(
  "Live integration passed. Factory, fee, evidence, committed panels, bonded rehearing, settlement and treasury forfeiture verified.",
);
