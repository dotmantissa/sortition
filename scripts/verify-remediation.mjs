/** Verify real Studio consensus, distinct economic actors and signed consumer delivery. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  chmodSync,
  mkdirSync,
} from "node:fs";
import { randomBytes, createHash, createHmac } from "node:crypto";
import { generatePrivateKey } from "viem/accounts";
import { createAccount } from "genlayer-js";
import { db } from "../lib/db.ts";
import {
  chain,
  readFinal,
  readTransaction,
  object,
  executionSucceeded,
  publicReceipt,
  networkClock,
  addresses,
} from "../lib/chain.ts";
import { workerTick } from "../lib/worker.ts";
import { digest, encrypt } from "../lib/security.ts";
nextEnv.loadEnvConfig(process.cwd());
mkdirSync(".vercel", { recursive: true, mode: 0o700 });
const base = process.env.SORTITION_URL || "https://sortition.vercel.app";
const statePath = "deployments/remediation-live.json";
const privatePath = ".vercel/remediation-verification-private.json";
const client = chain(),
  sql = db(),
  relay = client.account.address;
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : {};
const privateState = existsSync(privatePath)
  ? JSON.parse(readFileSync(privatePath, "utf8"))
  : { webhook_secret: randomBytes(32).toString("hex"), keys: {} };
function save() {
  writeFileSync(statePath + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(statePath + ".tmp", statePath);
  writeFileSync(privatePath, JSON.stringify(privateState), { mode: 0o600 });
  chmodSync(privatePath, 0o600);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const canonical = (value) =>
  value === null || typeof value !== "object"
    ? JSON.stringify(value)
    : Array.isArray(value)
      ? "[" + value.map(canonical).join(",") + "]"
      : "{" +
        Object.keys(value)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
          .join(",") +
        "}";
async function request(role, path, method = "GET", body, key) {
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(role ? { Authorization: "Bearer " + privateState.keys[role] } : {}),
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await r.json();
  if (!r.ok)
    throw Error(
      "Service " + r.status + ": " + String(result.error || "request failed"),
    );
  return result;
}
async function operation(id) {
  return (
    await sql`SELECT id,kind,status,tx_hash,error FROM operations WHERE id=${id}`
  )[0];
}
async function tick() {
  try {
    await workerTick();
  } catch {
    console.log("A service read needs another tick.");
  }
}
async function waitOperation(id, label) {
  for (let i = 0; i < 360; i++) {
    await tick();
    const op = await operation(id);
    if (op.status === "complete") {
      console.log("Verified", label, op.tx_hash);
      return op;
    }
    if (["failed", "needs_review"].includes(op.status))
      throw Error(label + ": " + op.error);
    await sleep(10000);
  }
  throw Error("Timed out waiting for " + label + "; resume saved operation.");
}
async function action(role, kind, suffix = kind) {
  if (state.operations?.[suffix]) return state.operations[suffix];
  const result = await request(
    role,
    `/api/questions/${state.question_id}/actions`,
    "POST",
    {
      action: kind,
      ...(kind === "challenge" ? { expected_outcome: "NO" } : {}),
    },
    "remediation-v7b:" + state.question_id + ":" + suffix,
  );
  state.operations ??= {};
  state.operations[suffix] = result.id;
  save();
  return result.id;
}
async function run() {
  if (state.verified) {
    for (const key of Object.values(privateState.keys))
      await sql`UPDATE api_keys SET revoked_at=now() WHERE key_hash=${digest(key)}`;
    console.log("Already verified. Saved public proof remains available.");
    return;
  }
  if (!state.actors) {
    state.actors = {
      operator: {
        id: "sortition:verification:v7b:operator",
        beneficiary: createAccount(generatePrivateKey()).address,
      },
      challenger: {
        id: "sortition:verification:v7b:challenger",
        beneficiary: createAccount(generatePrivateKey()).address,
      },
      sponsor: { id: "sortition:verification:v7b:sponsor", beneficiary: relay },
    };
    save();
  }
  for (const [role, actor] of Object.entries(state.actors)) {
    await sql`INSERT INTO operators(id,beneficiary) VALUES(${actor.id},${actor.beneficiary}) ON CONFLICT(id) DO NOTHING`;
    if (!privateState.keys[role]) {
      privateState.keys[role] = "srt_" + randomBytes(32).toString("hex");
      save();
    }
    await sql`INSERT INTO api_keys(id,owner_id,key_hash,prefix) VALUES(${crypto.randomUUID()},${actor.id},${digest(privateState.keys[role])},${privateState.keys[role].slice(0, 12)}) ON CONFLICT(key_hash) DO NOTHING`;
  }
  if (!state.specification) {
    state.specification = {
      question: "Does the IANA HTTP registry list status code 200 as OK?",
      criteria:
        "For each source independently return YES when it identifies HTTP status code 200 as OK, otherwise NO for a different final meaning, or UNKNOWN if absent. Extract the exact canonical value 200=ok for OK, 200=other for a different final meaning, or unknown if absent. Choose the earliest source line that directly supports this reading as evidence_line. The contract applies unanimity and the global uncertainty definition separately.",
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
        "If any registered source is unreachable or does not identify HTTP code 200, this question is unresolvable. Otherwise the locked unanimity rule applies to the independently extracted positions.",
    };
    save();
  }
  if (!state.question_id) {
    const result = await request(
      "operator",
      "/api/questions",
      "POST",
      {
        specification: state.specification,
        fee: "10",
        base_bond: "2",
        webhook: {
          url: base + "/api/reference/settlement",
          secret: privateState.webhook_secret,
        },
      },
      "remediation-v7b-register",
    );
    state.question_id = result.id;
    state.operations = { register: result.operation_id };
    save();
    console.log("Registered", state.question_id);
  }
  await waitOperation(state.operations.register, "factory registration");
  const registered = object(
    await readFinal(addresses().registry, "get_question", [state.question_id]),
  );
  assert.equal(registered.version, 3);
  assert.equal(
    registered.criteria_hash,
    createHash("sha256").update(canonical(state.specification)).digest("hex"),
  );
  state.docket_address = registered.docket_address;
  state.criteria_hash = registered.criteria_hash;
  save();
  for (const [kind, address, path] of [
    ["vault", addresses().vault, "contracts/settlement_vault.py"],
    ["registry", addresses().registry, "contracts/question_registry.py"],
    ["docket", state.docket_address, "contracts/sortition_docket.py"],
  ]) {
    assert.equal(
      await client.getContractCode(address),
      readFileSync(path, "utf8"),
    );
    console.log("Source matches", kind, address);
  }
  await sql`INSERT INTO reference_receivers(question_id,venue,market_id,criteria_hash,docket_address,network,secret_ciphertext) VALUES(${state.question_id},'Sortition live verification','http-200',${state.criteria_hash},${state.docket_address},'studionet',${encrypt(privateState.webhook_secret)}) ON CONFLICT(question_id) DO NOTHING`;
  await waitOperation(await action("operator", "fund"), "funded fee");
  while ((await networkClock()).unix < state.specification.close_timestamp) {
    console.log("Waiting for the locked close.");
    await sleep(20000);
  }
  const resolveId = await action("operator", "resolve");
  state.native_protocol_appeals =
    "paused after the recorded Studio rollback failure";
  save();
  const original = await waitOperation(
    resolveId,
    "first jury and fresh window",
  );
  const first = object(await readFinal(state.docket_address, "get_docket"));
  assert.equal(first.rounds.at(-1).outcome, "YES");
  assert.ok(
    first.rounds
      .at(-1)
      .sources.every((s) => s.value === "200=ok" && s.reachable),
  );
  state.first_ruling = first.rounds.at(-1);
  state.resolution_receipt = publicReceipt(
    await readTransaction(original.tx_hash),
  );
  save();
  await waitOperation(
    await action("challenger", "challenge"),
    "distinct claimant funded bond",
  );
  let rehearing;
  for (let i = 0; i < 240; i++) {
    await tick();
    const rows =
      await sql`SELECT id,status,tx_hash,error FROM operations WHERE question_id=${state.question_id} AND kind='resolve' AND id<>${resolveId} ORDER BY created_at DESC LIMIT 1`;
    const op = rows[0];
    if (op?.status === "failed" && !state.retry_operation) {
      const retried = await action("challenger", "resolve", "rehearing-retry");
      state.retry_operation = retried;
      save();
    }
    if (op?.status === "needs_review")
      throw Error("Rehearing submission needs review.");
    if (op?.status === "complete") {
      rehearing = op;
      break;
    }
    await sleep(10000);
  }
  assert.ok(rehearing, "The paid rehearing must complete.");
  const second = object(await readFinal(state.docket_address, "get_docket"));
  assert.equal(second.rounds.length, 2);
  assert.equal(second.rounds.at(-1).outcome, "YES");
  const receipt = await readTransaction(rehearing.tx_hash);
  assert.ok(executionSucceeded(receipt));
  assert.equal(object(receipt.consensus_data).validators.length + 1, 7);
  state.rehearing_receipt = publicReceipt(receipt);
  state.rehearing_transaction = rehearing.tx_hash;
  save();
  let escrow = object(
    await readFinal(addresses().vault, "get_account", [state.question_id]),
  );
  assert.equal(escrow.opened_round, 2);
  assert.equal(escrow.challenges[0].payer.toLowerCase(), relay.toLowerCase());
  assert.equal(
    escrow.challenges[0].claimant.toLowerCase(),
    state.actors.challenger.beneficiary.toLowerCase(),
  );
  state.deadline = escrow.round_deadline;
  save();
  while ((await networkClock()).unix < state.deadline + 5) {
    console.log(
      "Waiting for the full finalized ruling challenge window.",
      state.deadline,
    );
    await sleep(30000);
  }
  await waitOperation(
    await action("operator", "finalize"),
    "finalized settlement",
  );
  escrow = object(
    await readFinal(addresses().vault, "get_account", [state.question_id]),
  );
  assert.equal(escrow.settled, true);
  assert.equal(escrow.outcome, "YES");
  for (const role of ["operator", "challenger"])
    assert.equal(
      await readFinal(addresses().vault, "get_credit", [
        state.actors[role].beneficiary,
      ]),
      "0",
    );
  if (!state.operations.withdraw)
    assert.equal(
      await readFinal(addresses().vault, "get_credit", [relay]),
      "12",
    );
  state.sponsored_bond_extraction_prevented = true;
  if (!state.balance_before)
    state.balance_before = (
      await client.getBalance({ address: relay })
    ).toString();
  save();
  const paid = await waitOperation(
    await action("sponsor", "withdraw"),
    "native payout",
  );
  const children = await client.getTriggeredTransactionIds({
    hash: paid.tx_hash,
  });
  const transfers = [];
  for (const hash of children) {
    const child = publicReceipt(await readTransaction(hash));
    if (child.transaction_type === 0) transfers.push(child);
  }
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].value_credited, true);
  assert.equal(String(transfers[0].value), "12");
  assert.equal(transfers[0].recipient.toLowerCase(), relay.toLowerCase());
  state.native_payment = transfers[0];
  state.balance_after = (
    await client.getBalance({ address: relay })
  ).toString();
  assert.equal(BigInt(state.balance_after) - BigInt(state.balance_before), 12n);
  assert.equal(await readFinal(addresses().vault, "get_credit", [relay]), "0");
  const confirmations =
    await sql`SELECT id FROM operations WHERE question_id=${state.question_id} AND kind='confirm_payment' ORDER BY created_at DESC LIMIT 1`;
  assert.ok(confirmations[0]);
  await waitOperation(confirmations[0].id, "delivery confirmation");
  assert.equal(
    object(await readFinal(addresses().vault, "get_payment", [relay])).status,
    "delivered",
  );
  state.native_withdrawal_verified = true;
  save();
  let reference;
  for (let i = 0; i < 30; i++) {
    await tick();
    const response = await fetch(
      base + "/api/reference/settlement?question_id=" + state.question_id,
    );
    if (response.ok) {
      reference = await response.json();
      break;
    }
    await sleep(10000);
  }
  assert.equal(reference.outcome, "YES");
  assert.equal(reference.action, "pay_yes");
  state.reference_consumer = reference;
  const delivered = (
    await sql`SELECT id,payload,status FROM deliveries WHERE question_id=${state.question_id}`
  )[0];
  assert.equal(delivered.status, "delivered");
  const body = JSON.stringify(delivered.payload),
    timestamp = String(
      (
        await sql`SELECT floor(extract(epoch from now()))::bigint AS timestamp`
      )[0].timestamp,
    ),
    signature = createHmac("sha256", privateState.webhook_secret)
      .update(`${timestamp}.${delivered.id}.${body}`)
      .digest("hex");
  const headers = {
    "Content-Type": "application/json",
    "Sortition-Event-Id": delivered.id,
    "Sortition-Signature": `t=${timestamp},v1=${signature}`,
  };
  const duplicate = await fetch(base + "/api/reference/settlement", {
    method: "POST",
    headers,
    body,
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  const tampered = await fetch(base + "/api/reference/settlement", {
    method: "POST",
    headers: { ...headers, "Sortition-Event-Id": crypto.randomUUID() },
    body,
  });
  assert.equal(tampered.status, 401);
  state.signed_webhook_verified = true;
  state.webhook_replay_deduplicated = true;
  state.webhook_event_id_tampering_rejected = true;
  state.settlement = await request(
    null,
    `/api/questions/${state.question_id}/settlement`,
  );
  assert.equal(state.settlement.final, true);
  state.verified = true;
  state.verified_at = new Date().toISOString();
  save();
  for (const key of Object.values(privateState.keys))
    await sql`UPDATE api_keys SET revoked_at=now() WHERE key_hash=${digest(key)}`;
  console.log(
    "PASS: deployed source parity, real independent evidence, seven member paid rehearing, finalized window, distinct actor sponsor accounting, native delivery, pinned signed consumer and replay rejection.",
  );
}
run().catch((error) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Verification interrupted. Resume the saved operation.",
  );
  process.exitCode = 1;
});
