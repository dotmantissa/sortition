/* eslint-disable @typescript-eslint/no-explicit-any -- Persisted public network evidence is deliberately inspected at runtime. */
/** Resumable real Studio acceptance scenarios; never invent receipts or resend ambiguous writes. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  chain,
  addresses,
  networkClock,
  object,
  readFinal,
  readTransaction,
  statusName,
  executionSucceeded,
  publicReceipt,
} from "../lib/chain";
import { db } from "../lib/db";
import { questionState } from "../lib/lifecycle";
import { parseSettlement } from "../lib/settlement";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/reviewer-v9.json",
  secretPath = ".vercel/reviewer-actors.json";
const base = "https://sortition.vercel.app";
const state: any = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      network: "studionet",
      fixture_notice:
        "Explicit synthetic web evidence tests, not claims of real sports events or venue payments",
      operations: {},
      cases: {},
    };
if (state.verified) {
  assert.deepEqual(
    state.contracts,
    addresses(),
    "Archive an older deployment record before starting a new review suite",
  );
  console.log(
    "Recorded review suite is already verified; no payments repeated.",
  );
  process.exit(0);
}
const privateState = existsSync(secretPath)
  ? JSON.parse(readFileSync(secretPath, "utf8"))
  : { outsider: "0x" + randomBytes(32).toString("hex") };
writeFileSync(secretPath, JSON.stringify(privateState), { mode: 0o600 });
function save() {
  writeFileSync(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}
function client(panel = 5, outsider = false) {
  return chain(panel, outsider ? privateState.outsider : undefined);
}

if (state.contracts)
  assert.deepEqual(
    state.contracts,
    addresses(),
    "Resume against the recorded deployment, never a replacement vault",
  );
else state.contracts = addresses();
state.actors = {
  relay: client().account!.address,
  outsider: client(5, true).account!.address,
};
save();

const pause = (ms = 10000) => new Promise((r) => setTimeout(r, ms));
async function finalized(hash: string, success: boolean | null = true) {
  for (let i = 0; i < 240; i++) {
    let receipt: any;
    try {
      receipt = await readTransaction(hash as `0x${string}`);
    } catch {
      await pause();
      continue;
    }
    if (statusName(receipt) === "FINALIZED") {
      if (success !== null)
        assert.equal(
          executionSucceeded(receipt),
          success,
          "Unexpected execution effect: " + hash,
        );
      return receipt;
    }
    await pause();
  }
  throw Error(
    "Receipt polling exceeded its bound. Resume stored hash: " + hash,
  );
}
async function send(
  key: string,
  address: any,
  method: string,
  args: any[],
  value = 0n,
  panel = 5,
  outsider = false,
  success: boolean | null = true,
) {
  let op = state.operations[key];
  if (!op) {
    op = state.operations[key] = {
      address,
      method,
      args: args.map((x) => (typeof x === "bigint" ? String(x) : x)),
      value: String(value),
      requested_panel: panel,
      sender: outsider ? state.actors.outsider : state.actors.relay,
      submission_in_progress: true,
    };
    save();
    op.tx_hash = await client(panel, outsider).writeContract({
      address,
      functionName: method,
      args,
      value,
    });
    delete op.submission_in_progress;
    save();
    console.log("submitted", key, op.tx_hash);
  }
  if (op.submission_in_progress || !op.tx_hash)
    throw Error("Reconcile ambiguous submission: " + key);
  const receipt = await finalized(op.tx_hash, success);
  op.receipt = publicReceipt(receipt);
  assert.equal(
    String(op.receipt.sender).toLowerCase(),
    op.sender.toLowerCase(),
    "The requested actor must actually sign the transaction",
  );
  save();
  // Child handoffs must themselves finalize; parent success is insufficient.
  for (const child of (object(receipt).triggered_transactions as string[]) ||
    []) {
    op.children ??= {};
    op.children[child] = publicReceipt(
      await finalized(child, success === false ? null : true),
    );
    save();
  }
  const question =
    state.cases[
      key.split(":")[0] === "payment" ? "undersized" : key.split(":")[0]
    ];
  if (question?.id) {
    const sql = db();
    await sql`INSERT INTO receipts(tx_hash,question_id,kind,receipt) VALUES(${op.tx_hash},${question.id},${method},${JSON.stringify(op.receipt)}::jsonb) ON CONFLICT(tx_hash) DO UPDATE SET receipt=EXCLUDED.receipt`;
    for (const [hash, child] of Object.entries(op.children || {}))
      await sql`INSERT INTO receipts(tx_hash,question_id,kind,receipt) VALUES(${hash},${question.id},'internal',${JSON.stringify(child)}::jsonb) ON CONFLICT(tx_hash) DO UPDATE SET receipt=EXCLUDED.receipt`;
  }
  return receipt;
}
function source(
  scenario: string,
  observation: number,
  n: number,
  switchAt?: number,
) {
  return {
    name: "Synthetic review source " + n,
    url: `${base}/api/review-evidence?scenario=${scenario}&observation=${observation}&source=${n}${switchAt ? "&switch_at=" + switchAt : ""}`,
  };
}
async function register(kind: string, fee: number) {
  if (state.cases[kind]?.registration_complete) return;
  if (!state.cases[kind]) {
    const close = (await networkClock()).unix + 150,
      observation = close + 120,
      resolution = observation + 90;
    const scenario = ["undersized", "native"].includes(kind) ? "event" : kind;
    const switchAt = Math.floor(Date.now() / 1000) + 180;
    const sources: any[] = [
      source(
        scenario,
        observation,
        1,
        kind === "historical" ? switchAt : undefined,
      ),
      source(
        scenario,
        observation,
        2,
        kind === "historical" ? switchAt : undefined,
      ),
    ];
    const snapshot: any[] = [];
    if (kind === "historical")
      for (const s of sources) {
        const body = await (await fetch(s.url)).text();
        assert.ok(body.includes("original snapshot"));
        s.content_sha256 = createHash("sha256").update(body).digest("hex");
        snapshot.push({ url: s.url, digest: s.content_sha256, text: body });
      }
    state.cases[kind] = {
      id: "review-v9-" + kind + "-" + randomUUID(),
      fee,
      snapshot,
      specification: {
        question:
          scenario === "event"
            ? "Did the synthetic fixture home team win the completed match?"
            : "Did the authoritative fixture rate exceed five percent?",
        criteria:
          scenario === "event"
            ? "YES if the final fixture match score shows a home win, NO for a final away win or draw. This is a synthetic acceptance test; use the fixture evidence as the registered authority. Event ends at observation_timestamp; a final report published afterwards is valid. Extract home=2,away=1 for that final score. Trading closed before the event."
            : "YES if the final authoritative fixture rate at observation_timestamp exceeds 5 percent, NO for a final rate at or below 5 percent. This is a synthetic acceptance test; use the fixture bulletins as registered authorities. Extract the exact numeric rate and inspect every correction or retraction.",
        unresolvable_definition:
          "No final event/state evidence, a corrected historical snapshot, missing dated provenance or an uninspected qualification makes this test unresolvable. Synthetic fixture labeling is not itself uncertainty.",
        sources,
        tie_break_url: sources[0].url,
        disagreement_rule: "unanimous",
        close_timestamp: close,
        observation_timestamp: observation,
        resolution_timestamp: resolution,
        evidence_mode:
          kind === "historical" ? "historical_state" : "event_outcome",
      },
    };
    save();
  }
  const entry = state.cases[kind];
  await send(kind + ":register", state.contracts.registry, "register", [
    entry.id,
    JSON.stringify(entry.specification),
    state.actors.relay,
    BigInt(fee),
    2n,
  ]);
  const registered = object(
    await readFinal(state.contracts.registry, "get_question", [entry.id]),
  );
  entry.docket = registered.docket_address;
  entry.criteria_hash = registered.criteria_hash;
  save();
  const sql = db(),
    owner = "sortition:review-v9";
  await sql`INSERT INTO operators(id,beneficiary) VALUES(${owner},${state.actors.relay}) ON CONFLICT(id) DO NOTHING`;
  await sql`INSERT INTO questions(id,owner_id,specification,beneficiary,fee,base_bond,registry_address,vault_address,docket_address,criteria_hash,status) VALUES(${entry.id},${owner},${JSON.stringify(entry.specification)}::jsonb,${state.actors.relay},${String(fee)},'2',${state.contracts.registry},${state.contracts.vault},${entry.docket},${entry.criteria_hash},'ready') ON CONFLICT(id) DO NOTHING`;
  if (fee > 0)
    await send(
      kind + ":fund",
      state.contracts.vault,
      "fund",
      [entry.id],
      BigInt(fee),
    );
  entry.registration_complete = true;
  save();
}
async function snapshot(kind: string, label: string) {
  const e = state.cases[kind];
  const escrow = await readFinal(state.contracts.vault, "get_account", [e.id]);
  let docket: any;
  try {
    docket = await readFinal(e.docket, "get_docket");
  } catch {
    docket = { unavailable: true, rounds: [] };
  }
  e[label] = { escrow, docket, recorded_at: new Date().toISOString() };
  save();
  const checks = (docket.rounds || []).map((r: any) => ({
    ...r.panel_check,
    leader_only: r.panel_check.independent_validators === 0,
    round: r.round,
    tx_hash: r.tx_hash,
  }));
  const sql = db();
  const status = questionState(
    object(escrow),
    (docket.rounds || []).length,
    e.specification.resolution_timestamp,
    (await networkClock()).unix,
  );
  await sql`UPDATE questions SET docket=${JSON.stringify(docket)}::jsonb,escrow=${JSON.stringify(escrow)}::jsonb,panel_checks=${JSON.stringify(checks)}::jsonb,indexed_at=now(),next_index_at=now()+interval '1 day',status=${status} WHERE id=${e.id}`;
  return { escrow: object(escrow), docket };
}
async function waitTime(timestamp: number, label: string) {
  while ((await networkClock()).unix < timestamp) {
    console.log(
      "waiting",
      label,
      Math.max(0, timestamp - (await networkClock()).unix),
    );
    await pause(30000);
  }
}
async function hearing(kind: string, panel = 9, outsider = false) {
  const e = state.cases[kind];
  if (e.after_verification) return e.after_verification;
  const raw = await send(
    kind + ":resolve",
    e.docket,
    "resolve",
    [],
    0n,
    panel,
    outsider,
  );
  const candidate = object(await readFinal(e.docket, "get_docket"))
    .candidates as any[];
  const marker = publicReceipt(raw).leaders.flatMap((l) =>
    String(l.stdout)
      .split("\n")
      .flatMap((line) => {
        try {
          return JSON.parse(line).sortition_candidate
            ? [JSON.parse(line).sortition_candidate]
            : [];
        } catch {
          return [];
        }
      }),
  )[0];
  assert.ok(marker?.candidate_id);
  if (!state.operations[kind + ":verify"]) {
    await snapshot(kind, "before_verification");
    const before = await (
      await fetch(`${base}/api/questions/${e.id}/settlement`)
    ).json();
    assert.equal(before.outcome, "PENDING");
    assert.equal(before.final, false);
    e.public_before = before;
    save();
  }
  await send(kind + ":verify", e.docket, "verify_hearing", [
    marker.candidate_id,
    state.operations[kind + ":resolve"].tx_hash,
  ]);
  return snapshot(kind, "after_verification");
}
// Prepare all scenarios before waiting for their event clock.
for (const [kind, fee] of [
  ["event", 0],
  ["historical", 0],
  ["incomplete", 0],
  ["undersized", 7],
  ["native", 9],
] as const)
  await register(kind, fee);
for (const e of Object.values(state.cases) as any[])
  await db()`UPDATE questions SET next_index_at=now()+interval '1 day' WHERE id=${e.id}`;
for (const kind of ["event", "historical", "incomplete"]) {
  await waitTime(
    state.cases[kind].specification.resolution_timestamp,
    kind + " resolution",
  );
  const { escrow, docket } = await hearing(kind);
  assert.equal(escrow.ruling_round, 1);
  assert.equal(
    docket.rounds[0].outcome,
    kind === "event" ? "YES" : "UNRESOLVABLE",
  );
  assert.equal(docket.rounds[0].jury_status, "verified");
  assert.ok(docket.rounds[0].panel_check.observed >= 5);
}
// A directly initiated hearing deliberately supplies fewer seats than funded.
const under = state.cases.undersized;
await waitTime(
  under.specification.resolution_timestamp + 900,
  "permissionless jury grace",
);
const rejected = await hearing("undersized", 3, true);
assert.equal(rejected.docket.rounds.length, 0);
assert.equal(rejected.escrow.ruling_round, 0);
assert.equal(rejected.docket.candidates.at(-1).jury_status, "rejected");
assert.ok(rejected.escrow.hearing_deadline > 0 && !rejected.escrow.settled);
under.public_rejected = await (
  await fetch(`${base}/api/questions/${under.id}/settlement`)
).json();
assert.equal(
  parseSettlement(under.public_rejected, { questionId: under.id }).final,
  false,
);
under.consumer_effect = "PENDING; no authoritative adjudication or payout";
save();
await send(
  "undersized:early_finalize",
  state.contracts.vault,
  "finalize",
  [under.id],
  0n,
  5,
  true,
  false,
);
// A fresh native protocol appeal remains distinct from bonded application hearings.
const native = state.cases.native;
if (!state.operations["native:resolve"]) {
  const op: any = (state.operations["native:resolve"] = {
    submission_in_progress: true,
  });
  save();
  op.tx_hash = await client(9).writeContract({
    address: native.docket,
    functionName: "resolve",
    args: [],
    value: 0n,
  });
  delete op.submission_in_progress;
  save();
}
const nativeHash = state.operations["native:resolve"].tx_hash;
if (!state.native_appeal) {
  for (let i = 0; i < 150; i++) {
    const receipt = await readTransaction(nativeHash);
    if (statusName(receipt) === "ACCEPTED") {
      state.native_appeal = {
        submission_in_progress: true,
        target_tx: nativeHash,
      };
      save();
      try {
        state.native_appeal.returned_tx = await client().appealTransaction({
          txId: nativeHash,
          value: 0n,
        });
      } catch {
        state.native_appeal.submission_error =
          "Protocol rejected submission; no successful native appeal claimed";
      }
      delete state.native_appeal.submission_in_progress;
      save();
      break;
    }
    if (statusName(receipt) === "FINALIZED") {
      state.native_appeal = {
        target_tx: nativeHash,
        unavailable:
          "Finality reached before appeal submission; no fresh native appeal claimed",
      };
      save();
      break;
    }
    await pause(4000);
  }
}
// Record a real rejected native submission even when Studio finalized before
// the short accepted window could be observed. Do not label a skipped poll as
// a failed appeal, and never silently retry an ambiguous protocol broadcast.
if (
  state.native_appeal?.unavailable &&
  !state.native_appeal.finalized_attempt
) {
  const attempt: any = {
    target_tx: nativeHash,
    submission_in_progress: true,
    attempted_after_observed_finality: true,
  };
  state.native_appeal.finalized_attempt = attempt;
  save();
  const priorFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init: any) => {
    const response = await priorFetch(input, init);
    let method = "";
    try {
      method = JSON.parse(String(init?.body)).method;
    } catch {
      /* not RPC */
    }
    if (
      String(input) ===
        (process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api") &&
      method === "eth_sendRawTransaction"
    ) {
      const result = await response.clone().json();
      if (
        typeof result.result === "string" &&
        /^0x[0-9a-fA-F]{64}$/.test(result.result)
      )
        attempt.submission_tx_hash = result.result;
      if (result.error)
        attempt.rpc_rejection = {
          code: result.error.code,
          reason: "Native protocol submission rejected by Studio",
        };
      save();
    }
    return response;
  }) as typeof fetch;
  try {
    attempt.returned_tx = await client().appealTransaction({
      txId: nativeHash,
      value: 0n,
    });
    delete attempt.submission_in_progress;
  } catch {
    if (!attempt.rpc_rejection && !attempt.submission_tx_hash) {
      save();
      throw Error(
        "Native submission is ambiguous; reconcile its stored target and relay nonce before resuming",
      );
    }
    attempt.submission_error =
      "Native appeal did not complete successfully; inspect the captured public RPC rejection or submission reference";
    delete attempt.submission_in_progress;
  } finally {
    globalThis.fetch = priorFetch;
    save();
  }
  await pause(10000);
}
state.operations["native:resolve"].receipt = publicReceipt(
  await finalized(nativeHash, null),
);
save();
await snapshot("native", "after_native_appeal");
// Settle complete verified evidence and prove each unsettled funded exit.
for (const kind of ["event", "historical", "incomplete"]) {
  const e = state.cases[kind];
  if (e.final_state || e.refunded_state) continue;
  const current = object(
    await readFinal(state.contracts.vault, "get_account", [e.id]),
  );
  await waitTime(
    Number(current.round_deadline) + 2,
    kind + " challenge window",
  );
  await send(
    kind + ":finalize",
    state.contracts.vault,
    "finalize",
    [e.id],
    0n,
    5,
    true,
  );
  await snapshot(kind, "final_state");
  const published = await (
    await fetch(`${base}/api/questions/${e.id}/settlement`)
  ).json();
  const parsed = parseSettlement(published, {
    questionId: e.id,
    criteriaHash: e.criteria_hash,
    docketAddress: e.docket,
    network: "studionet",
  });
  assert.equal(parsed.final, true);
  assert.equal(parsed.panel_verified, true);
  e.public_final = published;
  save();
}
for (const kind of ["undersized", "native"]) {
  const e = state.cases[kind];
  if (e.final_state || e.refunded_state) continue;
  const current = object(
    await readFinal(state.contracts.vault, "get_account", [e.id]),
  );
  await waitTime(
    Number(current.hearing_deadline) + 2,
    kind + " escrow recovery",
  );
  await send(
    kind + ":timeout",
    state.contracts.vault,
    "claim_timeout",
    [e.id],
    0n,
    5,
    true,
  );
  const { escrow } = await snapshot(kind, "refunded_state");
  assert.equal(escrow.outcome, "REFUNDED");
  assert.equal(escrow.refunded, true);
}
if (!state.operations["payment:withdraw"]) {
  state.refund_credit = await readFinal(state.contracts.vault, "get_credit", [
    state.actors.relay,
  ]);
  assert.equal(state.refund_credit, "16");
  state.balance_before = String(
    await client().getBalance({ address: state.actors.relay }),
  );
  save();
}
await send("payment:withdraw", state.contracts.vault, "withdraw", [
  state.actors.relay,
]);
state.balance_after_withdrawal ??= String(
  await client().getBalance({ address: state.actors.relay }),
);
save();
const payment: any =
  state.payment_pending ??
  (await readFinal(state.contracts.vault, "get_payment", [state.actors.relay]));
assert.equal(
  BigInt(state.balance_after_withdrawal) - BigInt(state.balance_before),
  16n,
);
state.payment_pending = payment;
save();
// Unauthorized and false relay confirmations are finalized execution failures.
await send(
  "payment:unauthorized",
  state.contracts.vault,
  "confirm_withdrawal",
  [
    state.actors.relay,
    payment.id,
    state.operations["payment:withdraw"].tx_hash,
  ],
  0n,
  5,
  true,
  false,
);
await send(
  "payment:false_relay",
  state.contracts.vault,
  "confirm_withdrawal",
  [
    state.actors.relay,
    payment.id,
    state.operations["undersized:resolve"].tx_hash,
  ],
  0n,
  5,
  false,
  false,
);
if (!state.operations["payment:confirm"])
  assert.equal(
    object(
      await readFinal(state.contracts.vault, "get_payment", [
        state.actors.relay,
      ]),
    ).status,
    "pending",
  );
await send("payment:confirm", state.contracts.vault, "confirm_withdrawal", [
  state.actors.relay,
  payment.id,
  state.operations["payment:withdraw"].tx_hash,
]);
await send(
  "payment:duplicate_restore",
  state.contracts.vault,
  "restore_withdrawal",
  [
    state.actors.relay,
    payment.id,
    state.operations["payment:withdraw"].tx_hash,
  ],
  16n,
  5,
  false,
  false,
);
state.payment_delivered = await readFinal(
  state.contracts.vault,
  "get_payment",
  [state.actors.relay],
);
state.remaining_credit = await readFinal(state.contracts.vault, "get_credit", [
  state.actors.relay,
]);
state.balance_after = String(
  await client().getBalance({ address: state.actors.relay }),
);
assert.equal(state.payment_delivered.status, "delivered");
assert.equal(state.remaining_credit, "0");
// The reverted backed-restoration attempt must not be interpreted as a payout.
state.native_transfer_verified = true;
state.failure_coverage_notice =
  "Failed child ledger credit and backed retry are behaviorally tested in tests/direct/test_review.py; this live suite does not fabricate a failed Studio SEND transaction.";
state.verified = true;
save();
console.log("All finalized review scenarios verified.");
