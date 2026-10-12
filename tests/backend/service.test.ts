/* eslint-disable @typescript-eslint/no-explicit-any -- SQL results cross an isolated VM boundary in these authorization tests. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import crypto from "node:crypto";
import * as lifecycle from "../../lib/lifecycle";
import * as validation from "../../lib/validation";
import * as limits from "../../lib/sponsor-limits";
const compile = (file: string) =>
  ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function service(
  options: {
    pending?: boolean;
    archived?: boolean;
    duplicate?: boolean;
    changedExpected?: boolean;
    rounds?: number;
    escrow?: Record<string, unknown>;
    credit?: string;
    payment?: Record<string, unknown>;
    now?: number;
    quota?: number;
  } = {},
) {
  const calls: string[] = [];
  const reads: { fn: string; args: unknown[] }[] = [];
  const sql: any = async (strings: TemplateStringsArray) => {
    const q = strings.join("?");
    calls.push(q);
    if (q.includes("SELECT owner_id"))
      return [
        {
          owner_id: "operator",
          archive_reason: options.archived
            ? "Recorded Studio rollback failure"
            : null,
          vault_address: "0xvault",
          beneficiary: "0xoperatorwallet",
          escrow: {
            version: 2,
            opened_round: 1,
            funded: true,
            settled: false,
            challenge_count: options.pending ? 1 : 0,
            ...(options.escrow || {}),
          },
          docket: {
            rounds: Array.from({ length: options.rounds ?? 1 }, () => ({})),
          },
        },
      ];
    if (q.includes("SELECT id,tx_hash"))
      return options.duplicate
        ? [
            {
              id: "existing",
              kind: "challenge",
              question_id: "q",
              payload: { expected: options.changedExpected ? "YES" : "NO" },
            },
          ]
        : [];
    if (q.includes("SELECT count")) return [{ count: options.quota ?? 30 }];
    return [];
  };
  const exports: any = {};
  vm.runInNewContext(compile("lib/service.ts"), {
    exports,
    require: (m: string) =>
      m === "node:crypto"
        ? crypto
        : m === "./db"
          ? { db: () => sql }
          : m === "./auth"
            ? { HttpError }
            : m === "./lifecycle"
              ? lifecycle
              : m === "./validation"
                ? validation
                : m === "./chain"
                  ? {
                      networkClock: async () => ({ unix: options.now ?? 1000 }),
                      addresses: () => ({ vault: "0xvault" }),
                      object: (v: unknown) =>
                        v && typeof v === "object" ? v : {},
                      readFinal: async (
                        _address: string,
                        fn: string,
                        args: unknown[],
                      ) => {
                        reads.push({ fn, args });
                        if (fn === "get_credit") return options.credit ?? "0";
                        if (fn === "get_payment") return options.payment ?? {};
                        return {};
                      },
                    }
                  : m === "./security"
                    ? {
                        digest: (s: string) =>
                          crypto.createHash("sha256").update(s).digest("hex"),
                      }
                    : {},
  });
  return { exports, calls, reads };
}
test("a challenger may retry the funded failed rehearing without owning the market", async () => {
  const h = service({ pending: true });
  // Authorization passed: the deliberately exhausted quota is the next boundary.
  await assert.rejects(
    h.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "resolve",
      undefined,
      "new",
    ),
    (e: HttpError) => e.status === 429,
  );
});
test("an absent operator cannot block the first hearing or its settlement", async () => {
  // Nothing has been heard yet, so any authenticated account may ask for the
  // jury and, later, for settlement. Only the exhausted quota stops it here.
  for (const action of ["resolve", "finalize"]) {
    const h = service({ rounds: action === "resolve" ? 0 : 1 });
    await assert.rejects(
      h.exports.queueAction(
        { id: "challenger", beneficiary: "0xwallet" },
        "q",
        action,
        undefined,
        "new",
      ),
      (e: HttpError) => e.status === 429,
      action,
    );
  }
});
test("a completed hearing asks for a funded challenge rather than a free rerun", async () => {
  const h = service({ rounds: 1 });
  await assert.rejects(
    h.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "resolve",
      undefined,
      "new",
    ),
    (e: HttpError) => e.status === 409 && /Fund a challenge/.test(e.message),
  );
});
test("the resolution fee stays with the question operator", async () => {
  const h = service({ escrow: { funded: false } });
  await assert.rejects(
    h.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "fund",
      undefined,
      "new",
    ),
    (e: HttpError) => e.status === 403,
  );
});
test("an unrelated account cannot occupy a docket queue with its own withdrawal", async () => {
  const h = service({ escrow: { settled: true }, credit: "5" });
  await assert.rejects(
    h.exports.queueAction(
      { id: "stranger", beneficiary: "0xstranger" },
      "q",
      "withdraw",
      undefined,
      "grief",
    ),
    (e: HttpError) => e.status === 403,
  );
  assert.ok(!h.calls.some((q) => q.includes("INSERT INTO operations")));
});
test("a participant without withdrawable credit never creates a pending payment", async () => {
  const h = service({
    escrow: {
      settled: true,
      challenges: [{ payer: "0xwallet", claimant: "0xwallet" }],
    },
    credit: "0",
  });
  await assert.rejects(
    h.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "withdraw",
      undefined,
      "empty",
    ),
    (e: HttpError) => e.status === 409 && /no credit/.test(e.message),
  );
  assert.ok(h.reads.some((r) => r.fn === "get_credit"));
  assert.ok(!h.calls.some((q) => q.includes("INSERT INTO operations")));
});
test("a bonded payer with real credit may withdraw from a docket it does not own", async () => {
  const h = service({
    escrow: {
      settled: true,
      challenges: [{ payer: "0xwallet", claimant: "0xclaimant" }],
    },
    credit: "12",
    quota: 0,
  });
  const op = await h.exports.queueAction(
    { id: "challenger", beneficiary: "0xwallet" },
    "q",
    "withdraw",
    undefined,
    "payout",
  );
  assert.equal(op.status, "queued");
});
test("the bounded exit is refused until a funded hearing is actually overdue", async () => {
  const overdue = {
    version: 4,
    funded: true,
    settled: false,
    challenge_count: 0,
    ruling_round: 0,
    hearing_deadline: 900,
  };
  const early = service({ escrow: { ...overdue, hearing_deadline: 5000 } });
  await assert.rejects(
    early.exports.queueAction(
      { id: "stranger", beneficiary: "0xstranger" },
      "q",
      "claim_timeout",
      undefined,
      "early",
    ),
    (e: HttpError) => e.status === 409 && /not past its deadline/.test(e.message),
  );
  // Past the deadline with no ruling for the round, anyone may release it.
  const ready = service({ escrow: overdue, quota: 0 });
  const op = await ready.exports.queueAction(
    { id: "stranger", beneficiary: "0xstranger" },
    "q",
    "claim_timeout",
    undefined,
    "release",
  );
  assert.equal(op.status, "queued");
});
test("a beneficiary can queue confirmation of its own pending payment only", async () => {
  const none = service({
    escrow: { settled: true, beneficiary: "0xwallet" },
    payment: { id: "4", amount: "12", status: "delivered" },
  });
  await assert.rejects(
    none.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "confirm_payment",
      undefined,
      "confirm",
    ),
    (e: HttpError) => e.status === 409 && /no pending payment/.test(e.message),
  );
  const pending = service({
    escrow: { settled: true, beneficiary: "0xwallet" },
    payment: { id: "4", amount: "12", status: "pending" },
    quota: 0,
  });
  const op = await pending.exports.queueAction(
    { id: "challenger", beneficiary: "0xwallet" },
    "q",
    "confirm_payment",
    undefined,
    "confirm",
  );
  assert.equal(op.status, "queued");
  assert.ok(
    pending.calls.some(
      (q) => q.includes("INSERT INTO operations") && q.includes("confirm_payment"),
    ),
  );
});
test("the published self funded bond is the exact escalating stake", async () => {
  const h = service();
  const terms = h.exports.selfFundedChallenge({
    id: "q",
    base_bond: "2",
    vault_address: "0xvault",
    escrow: {
      funded: true,
      settled: false,
      challenge_count: 2,
      base_bond: "2",
      round_deadline: 1234,
    },
  });
  assert.equal(terms.value_wei, "8");
  assert.equal(terms.function, "challenge");
  assert.equal(terms.contract, "0xvault");
  assert.equal(terms.round_deadline, 1234);
  assert.equal(
    h.exports.selfFundedChallenge({
      id: "q",
      base_bond: "2",
      escrow: { funded: true, settled: true, challenge_count: 0 },
    }),
    null,
  );
});
test("an idempotent retry succeeds even when the new action quota is exhausted", async () => {
  const h = service({ duplicate: true });
  const op = await h.exports.queueAction(
    { id: "challenger", beneficiary: "0xwallet" },
    "q",
    "challenge",
    "NO",
    "same",
  );
  assert.equal(op.id, "existing");
  assert.ok(!h.calls.some((q) => q.includes("SELECT count")));
});
test("same key with a different challenged outcome is rejected", async () => {
  const h = service({ duplicate: true, changedExpected: true });
  await assert.rejects(
    h.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "challenge",
      "NO",
      "same",
    ),
    (e: HttpError) => e.status === 409,
  );
});
test("sponsorship reservation uses a serializable atomic budget check before payment", async () => {
  const queries: string[] = [];
  let transactionOptions: any;
  const sql: any = async (strings: TemplateStringsArray) => {
    queries.push(strings.join("?"));
    return [];
  };
  sql.transaction = async (_queries: any, options: any) => {
    transactionOptions = options;
    return [[{ operation_id: "op" }]];
  };
  const exports: any = {};
  vm.runInNewContext(compile("lib/sponsorship.ts"), {
    exports,
    require: (m: string) => (m === "./db" ? { db: () => sql } : limits),
  });
  await exports.reserveSponsorship("op", "owner", 2n);
  assert.equal(transactionOptions.isolationLevel, "Serializable");
  assert.ok(
    queries.some((q) => q.includes("sum(amount)") && q.includes("owner_id")),
  );
  await assert.rejects(
    exports.reserveSponsorship(
      "op2",
      "owner",
      limits.maximumSponsoredPayment + 1n,
    ),
    /limit/,
  );
});

test("the Studio API rejects paused native appeals before queuing any work", async () => {
  const h = service();
  await assert.rejects(
    h.exports.queueAction(
      { id: "operator", beneficiary: "0xwallet" },
      "q",
      "protocol_appeal",
      undefined,
      "native-paused",
    ),
    /paused/,
  );
  assert.equal(h.calls.length, 0);
});

test("a docket damaged by a network rollback cannot accept another funded action", async () => {
  const h = service({ archived: true });
  await assert.rejects(
    h.exports.queueAction(
      { id: "operator", beneficiary: "0xwallet" },
      "q",
      "fund",
      undefined,
      "archived-fund",
    ),
    /archived/,
  );
  assert.ok(!h.calls.some((q) => q.includes("INSERT INTO operations")));
});
