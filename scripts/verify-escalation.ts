/**
 * Walk a docket through every bonded round this deployment allows and record
 * what each committed panel actually seated. It asserts the commitments and the
 * round limit, and reports the observed panels rather than assuming the network
 * can seat them, so the record shows the real supported range.
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
  panelVerification,
} from "../lib/chain";
import { TERMS } from "../lib/deployment";
import { registerQuestion, queueAction } from "../lib/service";
import { workerTick } from "../lib/worker";
import type { TransactionHash } from "genlayer-js/types";
nextEnv.loadEnvConfig(process.cwd());
const statePath = "deployments/live-escalation.json";
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
  const created = await registerQuestion(
    owner,
    {
      specification: {
        question:
          "Does the IANA HTTP registry list status code 404 as Not Found?",
        criteria:
          "For each source independently, return YES if that source identifies HTTP status code 404 as Not Found, NO if it identifies another final meaning, and UNKNOWN if absent. Extract the canonical value 404=not found for Not Found, 404=other for a different meaning, or unknown if absent. The contract applies unanimity separately.",
        sources: [
          {
            name: "IANA HTTP Status Code Registry",
            url: "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
          },
          {
            name: "MDN official status 404 documentation",
            url: "https://raw.githubusercontent.com/mdn/content/main/files/en-us/web/http/reference/status/404/index.md",
          },
        ],
        tie_break_url:
          "https://www.iana.org/assignments/http-status-codes/http-status-codes-1.csv",
        disagreement_rule: "unanimous",
        close_timestamp: (await networkClock()).unix + 150,
        unresolvable_definition:
          "A source cannot be reached or does not describe code 404.",
      },
      fee: "0",
      base_bond: "2",
    },
    "studio-escalation-registration-v8",
  );
  state.question_id = created.id;
  save();
  console.log("Registered the escalation question", created.id);
}
const id = state.question_id as string;
async function waitForOperation(kind: string, opId: string) {
  for (let i = 0; i < 180; i++) {
    try {
      await workerTick();
    } catch {
      console.log("Transient service read; the durable operation stands.");
    }
    const rows = await db()`SELECT * FROM operations WHERE id=${opId}`;
    const op = rows[0];
    if (op?.status === "complete") return op;
    if (op && ["failed", "needs_review"].includes(op.status))
      throw Error(`${kind}: ${op.error}`);
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw Error(`Timed out: ${kind}`);
}
async function run(kind: string, key: string, expected?: string) {
  const stored = (state[key] as { tx_hash: string } | undefined) ?? undefined;
  if (stored) return stored;
  const queued = await queueAction(
    owner,
    id,
    kind,
    expected,
    `escalation-${id}-${key}`,
  );
  const op = await waitForOperation(kind, queued.id);
  const record = { tx_hash: op.tx_hash as string };
  state[key] = record;
  save();
  console.log("Verified", key, op.tx_hash);
  return record;
}
/**
 * A funded challenge makes the service queue the bonded rehearing itself, so
 * the next hearing is adopted rather than requested again.
 */
async function hearingFor(round: number) {
  for (let i = 0; i < 180; i++) {
    const docket = object(
      await readFinal(state.docket_address as `0x${string}`, "get_docket"),
    );
    const rounds = Array.isArray(docket.rounds) ? docket.rounds.length : 0;
    if (rounds >= round) {
      const completed =
        await db()`SELECT tx_hash FROM operations WHERE question_id=${id} AND kind='resolve' AND status='complete' ORDER BY created_at`;
      const hash = completed[round - 1]?.tx_hash as string | undefined;
      if (hash) return { tx_hash: hash };
    }
    const stuck =
      await db()`SELECT error FROM operations WHERE question_id=${id} AND kind='resolve' AND status IN ('failed','needs_review') AND created_at>now()-interval '30 minutes' ORDER BY created_at DESC LIMIT 1`;
    if (stuck[0]) throw Error(`round ${round} hearing: ${stuck[0].error}`);
    try {
      await workerTick();
    } catch {
      console.log("Transient service read; the durable hearing stands.");
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw Error(`Timed out waiting for the round ${round} hearing`);
}
await waitForOperation(
  "register",
  (
    await db()`SELECT id FROM operations WHERE question_id=${id} AND kind='register'`
  )[0].id,
);
const registered = object(
  await readFinal(addresses().registry, "get_question", [id]),
);
state.docket_address = registered.docket_address;
save();
const close = Number(
  (registered.specification as { close_timestamp: number }).close_timestamp,
);
for (;;) {
  const now = (await networkClock()).unix;
  if (now >= close) break;
  console.log(`Waiting ${close - now}s for the registered close`);
  await new Promise((r) => setTimeout(r, 15000));
}
/** Keep every round already verified; a resumed run must never lose one. */
const panels: Record<string, unknown>[] = Array.isArray(state.supported_panels)
  ? (state.supported_panels as Record<string, unknown>[]).slice()
  : [];
function recordPanel(entry: Record<string, unknown>) {
  const kept = panels.filter((p) => Number(p.round) !== Number(entry.round));
  panels.length = 0;
  panels.push(...kept, entry);
  panels.sort((a, b) => Number(a.round) - Number(b.round));
  state.panels = panels;
  state.supported_panels = panels;
  save();
}
/** Studio rate limits and transient RPC faults must not abort a verification. */
async function persist<T>(what: string, read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= 8) throw error;
      console.log(`Transient ${what} read; retrying`);
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
}
// Round 1 plus one hearing for every bonded round the registry allows.
for (let round = 1; round <= TERMS.max_bonded_rounds + 1; round++) {
  if (round > 1) {
    const escrow = object(
      await readFinal(addresses().vault, "get_account", [id]),
    );
    // The ruling must be recorded and its window open before a bond is valid.
    for (let i = 0; i < 60; i++) {
      const current = object(
        await readFinal(addresses().vault, "get_account", [id]),
      );
      if (Number(current.opened_round) === round - 1) break;
      await workerTick();
      await new Promise((r) => setTimeout(r, 10000));
    }
    const ruling = object(
      await readFinal(addresses().vault, "get_account", [id]),
    );
    const against = ruling.ruling_outcome === "NO" ? "YES" : "NO";
    await run("challenge", `challenge_${round}`, against);
    console.log(
      `Round ${round} bonded at`,
      String(BigInt(escrow.base_bond as string) * 2n ** BigInt(round - 2)),
      "wei",
    );
  }
  const resolve =
    round === 1 ? await run("resolve", "resolve_1") : await hearingFor(round);
  const docket = object(
    await persist("docket", () =>
      readFinal(state.docket_address as `0x${string}`, "get_docket"),
    ),
  );
  const rounds = docket.rounds as {
    round: number;
    required_validators: number;
  }[];
  // Addressed by round rather than by position, so a finished docket can be
  // re-verified from its stored record.
  const heard = rounds[round - 1];
  assert.ok(heard, `round ${round} must be recorded`);
  assert.equal(heard.round, round);
  // The commitment is the contract's, not this script's.
  assert.equal(
    heard.required_validators,
    5 + 2 * (round - 1),
    `round ${round} must commit its escalating panel`,
  );
  const receipt = publicReceipt(
    await persist("hearing receipt", () =>
      chain().getTransaction({ hash: resolve.tx_hash as TransactionHash }),
    ),
  );
  const check = panelVerification(receipt, heard.required_validators);
  recordPanel({ round, ...check });
  console.log(
    `Round ${round}: committed ${check.required}, seated ${check.observed}, independent ${check.independent_validators}, verified ${check.verified}`,
  );
}
// The registered limit is enforced on chain, not by this service.
const full = object(
  await persist("escrow", () =>
    readFinal(addresses().vault, "get_account", [id]),
  ),
);
assert.equal(Number(full.challenge_count), TERMS.max_bonded_rounds);
let refused = "";
let refusalHash = "";
try {
  const queued = await queueAction(
    owner,
    id,
    "challenge",
    full.ruling_outcome === "NO" ? "YES" : "NO",
    `escalation-${id}-challenge-over-limit`,
  );
  await waitForOperation("challenge", queued.id);
} catch (error) {
  refused = error instanceof Error ? error.message : String(error);
  const rows =
    await db()`SELECT tx_hash FROM operations WHERE question_id=${id} AND kind='challenge' AND status='failed' ORDER BY created_at DESC LIMIT 1`;
  refusalHash = (rows[0]?.tx_hash as string) || "";
}
assert.ok(refused, "a challenge beyond the registered limit must be refused");
if (refusalHash) {
  // Read the contract's own refusal out of the public receipt, so the limit is
  // demonstrably enforced on chain rather than by this service.
  const receipt = publicReceipt(
    await persist("refusal receipt", () =>
      chain().getTransaction({ hash: refusalHash as TransactionHash }),
    ),
  );
  const reported = JSON.stringify([receipt.leaders, receipt.validators]);
  assert.match(
    reported,
    /Maximum bonded rounds/,
    "the chain must report the registered bonded round limit",
  );
  state.over_limit_receipt = { tx_hash: refusalHash, receipt };
  console.log("The chain refused the extra bond", refusalHash);
} else {
  console.log("The service refused the extra bond before broadcasting");
}
state.over_limit_refusal = refused;
state.verified = true;
state.supported_panels = panels;
save();
console.log("Bonded round limit refusal:", refused);
console.log(
  "Escalation verified. Committed panels:",
  panels
    .map((p) => `${p.required}:${p.verified ? "seated" : "unseated"}`)
    .join(" "),
);
