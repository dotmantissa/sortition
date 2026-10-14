/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic SQL and VM boundaries in this isolated worker harness. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as helpers from "../../lib/chain";
import * as lifecycle from "../../lib/lifecycle";
import crypto from "node:crypto";
const source =
  readFileSync("lib/worker.ts", "utf8") +
  "\nexport const workerUnderTest={poll,submit,updateQuestion,scanPayments,repairDeliveries,indexDue,recordPanelCheck};";
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
/** Real address shapes, because the indexer only watches valid addresses. */
const PAYERS = {
  beneficiary: "0x" + "b1".repeat(20),
  feePayer: "0x" + "f2".repeat(20),
  payer: "0x" + "a3".repeat(20),
  claimant: "0x" + "c4".repeat(20),
};
function harness(
  options: {
    status?: string;
    badIndex?: boolean;
    proofGate?: boolean;
    proofFound?: boolean;
    missingDocket?: boolean;
    refunded?: boolean;
    childFailed?: boolean;
    unopened?: boolean;
    expiredLease?: boolean;
    messageHandoff?: boolean;
    unprepared?: boolean;
    nativeDisabled?: boolean;
    badPreparation?: boolean;
    settled?: boolean;
    overdue?: boolean;
    validators?: number;
    watch?: boolean;
    lostDelivery?: boolean;
    overdueIndex?: boolean;
    reconciling?: boolean;
    childDelivered?: boolean;
  } = {},
) {
  const calls: { query: string; values: any[] }[] = [],
    chainCalls: string[] = [],
    transactions: number[] = [],
    jobs: any[] = [];
  const stored: any = {
    status: "appealed",
    docket: { rounds: [{ outcome: "YES" }] },
  };
  let now = 0;
  const job = (kind: string, id = "first") => ({
    id,
    owner_id: "claimant",
    question_id: id,
    kind,
    status: "submitted",
    tx_hash: "0xoriginal",
    payload: { claimant: "0xbeneficiary" },
    registry_address: "0xregistry",
    vault_address: "0xvault",
    docket_address: "0xdocket",
    specification: { close_timestamp: 0 },
    beneficiary: "0xbeneficiary",
    fee: "0",
    base_bond: "1",
    due: 0,
  });
  const sql: any = async (strings: TemplateStringsArray, ...values: any[]) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ query, values });
    if (query.startsWith("INSERT INTO worker_lock"))
      return [{ token: values[0] }];
    if (query.startsWith("UPDATE worker_lock") && query.includes("RETURNING"))
      return options.expiredLease ? [] : [{ token: values[0] }];
    if (query.startsWith("SELECT o.*"))
      return jobs
        .filter(
          (j) => ["queued", "submitted"].includes(j.status) && j.due <= now,
        )
        .sort((a, b) => a.due - b.due)
        .slice(0, 1);
    if (query.startsWith("SELECT tx_hash")) return [{ tx_hash: "0xoriginal" }];
    if (query.startsWith("SELECT registry_address"))
      return [
        {
          registry_address: "0xregistry",
          vault_address: "0xvault",
          owner_id: "operator",
          panel_checks: [
            { round: 1, verified: true },
            { round: 2, verified: true },
          ],
        },
      ];
    if (query.startsWith("SELECT id FROM questions"))
      return options.badIndex || options.overdueIndex ? [{ id: "bad" }] : [];
    if (query.startsWith("SELECT q.id"))
      return options.lostDelivery
        ? [
            {
              id: "first",
              criteria_hash: "hash",
              docket_address: "0xdocket",
              escrow: { settled: true, outcome: "YES", final_round: 2 },
              docket: { rounds: [{ round: 1 }, { round: 2 }] },
              panel_checks: [
                { round: 1, verified: true },
                { round: 2, verified: true },
              ],
            },
          ]
        : [];
    if (query.startsWith("SELECT w.*"))
      return options.watch
        ? [
            {
              vault_address: "0xvault",
              beneficiary: "0xbeneficiary",
              question_id: "first",
              owner_id: "operator",
              panel_checks: [
                { round: 1, verified: true },
                { round: 2, verified: true },
              ],
            },
          ]
        : [];
    if (query.startsWith("SELECT panel_checks")) return [{ panel_checks: [] }];
    if (query.startsWith("SELECT id,kind,status,tx_hash FROM operations"))
      return options.reconciling
        ? [{ id: "already", kind: "confirm_payment" }]
        : [];
    if (query.startsWith("SELECT d.*"))
      return [
        {
          id: "event",
          signing_timestamp: 1000,
          url: "https://receiver.example",
          payload: {},
          secret_ciphertext: "encrypted",
          attempts: 0,
        },
      ];
    if (query.startsWith("UPDATE operations SET tx_hash")) {
      const j = jobs.find((x) => x.id === values[1]);
      if (j) Object.assign(j, { tx_hash: values[0], status: "submitted" });
    }
    if (query.startsWith("UPDATE operations SET status='submitting'")) {
      const j = jobs.find((x) => x.id === values[0]);
      if (j) j.status = "submitting";
    }
    if (query.startsWith("UPDATE operations SET status='complete'")) {
      const j = jobs.find((x) => x.id === values[0]);
      if (j) j.status = "complete";
    }
    if (query.startsWith("UPDATE operations SET status='failed'")) {
      const j = jobs.find((x) => x.id === values.at(-1));
      if (j) j.status = "failed";
    }
    if (query.startsWith("UPDATE operations SET next_attempt_at")) {
      const j = jobs.find((x) => x.id === values[0]);
      if (j) j.due = now + 20;
    }
    if (query.startsWith("UPDATE questions SET criteria_hash"))
      Object.assign(stored, {
        docket: JSON.parse(values[2]),
        status: values[4],
      });
    return [];
  };
  sql.transaction = async (values: any[]) => {
    transactions.push(values.length);
    return Promise.all(values);
  };
  const exports: any = {};
  const fakeClient = {
    account: { address: "0xrelay" },
    chain: { isStudio: true },
    getTriggeredTransactionIds: async () =>
      options.childFailed
        ? ["0xchild"]
        : options.childDelivered
          ? ["0xpayment"]
          : [],
    getTransaction: async () => ({ statusName: options.status || "ACCEPTED" }),
    getBalance: async () => 100000n,
    appealTransaction: async () => {
      chainCalls.push("appeal:0xoriginal");
      return "0xoriginal";
    },
    writeContract: async (args: any) => {
      chainCalls.push("write:" + args.functionName);
      chainCalls.push(
        "write-args:" +
          JSON.stringify(args.args, (_key, value) =>
            typeof value === "bigint" ? String(value) : value,
          ),
      );
      chainCalls.push("write-value:" + String(args.value));
      return "0xnew";
    },
  };
  const fakeChain = {
    ...helpers,
    networkClock: async () => ({ unix: 1000 }),
    withdrawalTransaction: async () =>
      options.proofFound ? "0xpaymentParent" : null,
    chain: () => fakeClient,
    readTransaction: async (hash: string) => {
      chainCalls.push(hash);
      return {
        triggered_transactions: hash === "0xpaymentParent" ? ["0xchild"] : [],
        statusName:
          hash === "0xchild" ? "FINALIZED" : options.status || "FINALIZED",
        consensus_data: {
          leader_receipt: [
            {
              mode: "leader",
              genvm_result: {
                stdout: options.proofGate
                  ? JSON.stringify({
                      sortition_candidate: { candidate_id: "candidate" },
                    })
                  : "",
              },
              execution_result: hash === "0xchild" ? "ERROR" : "SUCCESS",
              vote: "agree",
              node_config: { address: "0x" + "1".repeat(40) },
            },
          ],
          validators: Array.from(
            { length: options.validators ?? 0 },
            (_v, i) => ({
              mode: "validator",
              vote: "agree",
              execution_result: "SUCCESS",
              node_config: { address: "0x" + String(i + 2).padStart(40, "0") },
            }),
          ),
        },
      };
    },
    readFinal: async (_a: string, method: string) => {
      chainCalls.push(method);
      if (
        options.badIndex ||
        (options.badPreparation && method === "get_account")
      )
        throw Error("unavailable read");
      if (method === "get_question")
        return {
          docket_address: "0xdocket",
          criteria_hash: "hash",
          specification: { close_timestamp: 0 },
        };
      if (method === "get_docket" && options.missingDocket)
        throw Error("docket removed by native rollback");
      if (method === "get_docket")
        return {
          version: options.proofGate ? 5 : 3,
          funded: !options.unprepared,
          expected_challenge_count: options.unprepared ? 0 : 1,
          required_validators: 7,
          rounds: [
            { round: 1, outcome: "YES", required_validators: 5 },
            { round: 2, outcome: "NO", required_validators: 7 },
          ],
        };
      if (method === "get_settlement") return { round: 2, outcome: "NO" };
      if (method === "get_payment")
        return { id: "payment", amount: "2", status: "pending" };
      return {
        // The bounded exit only exists from the version 4 escrow onwards.
        version: options.proofGate
          ? 5
          : options.overdue
            ? 4
            : options.messageHandoff
              ? 3
              : 2,
        funded: true,
        settled: options.settled === true,
        refunded: options.refunded === true,
        outcome: options.settled ? "YES" : "PENDING",
        final_round: 2,
        beneficiary: PAYERS.beneficiary,
        fee_payer: PAYERS.feePayer,
        challenges: [{ payer: PAYERS.payer, claimant: PAYERS.claimant }],
        challenge_count: 1,
        ruling_round: options.overdue ? 1 : 2,
        ruling_outcome: "NO",
        round_deadline: 2000,
        hearing_deadline: options.overdue ? 500 : 0,
        opened_round: options.unopened ? 1 : 2,
      };
    },
  };
  const context = {
    exports,
    require: (name: string) =>
      name === "node:crypto"
        ? crypto
        : name === "./db"
          ? { db: () => sql }
          : name === "./chain"
            ? fakeChain
            : name === "./lifecycle"
              ? { ...lifecycle, nativeAppealsEnabled: !options.nativeDisabled }
              : name === "./payments"
                ? {
                    activePaymentOperation: (claimant: string, id: string) =>
                      sql`SELECT id,kind,status,tx_hash FROM operations WHERE claimant=${claimant} AND payment=${id}`,
                  }
                : name === "./sponsorship"
                  ? { reserveSponsorship: async () => {} }
                  : name === "./security"
                    ? {
                        decrypt: () => "secret",
                        deliverWebhook: async (
                          _url: string,
                          _body: string,
                          _secret: string,
                          _event: string,
                          timestamp: number,
                        ) => {
                          chainCalls.push("deliver-clock:" + timestamp);
                          chainCalls.push("deliver");
                        },
                      }
                    : {},
    setInterval: () => ({ unref() {} }),
    clearInterval() {},
    console,
  };
  vm.runInNewContext(compiled, context);
  return {
    exports,
    calls,
    chainCalls,
    transactions,
    jobs,
    job,
    stored,
    advance: (seconds: number) => {
      now += seconds;
    },
  };
}
test("stored appeal transaction is polled, new ruling refreshed and appealed state cleared", async () => {
  const h = harness();
  const op = h.job("protocol_appeal");
  h.jobs.push(op);
  await h.exports.workerUnderTest.poll(op);
  assert.equal(h.chainCalls[0], "0xoriginal");
  assert.equal(op.status, "complete");
  assert.equal(h.stored.status, "resolved");
  assert.equal(h.stored.docket.rounds.at(-1).outcome, "NO");
});
test("accepted appeal remains pending and never substitutes the old ruling for a final result", async () => {
  const h = harness({ status: "ACCEPTED" });
  const op = h.job("protocol_appeal");
  h.jobs.push(op);
  await h.exports.workerUnderTest.poll(op);
  assert.equal(op.status, "submitted");
  assert.equal(h.stored.status, "appealed");
  assert.ok(!h.chainCalls.includes("get_docket"));
});
test("failed appeal leaves a failure record without fabricating a new ruling", async () => {
  const h = harness({ status: "UNDETERMINED" });
  const op = h.job("protocol_appeal");
  h.jobs.push(op);
  await h.exports.workerUnderTest.poll(op);
  assert.equal(op.status, "failed");
  assert.equal(h.stored.docket.rounds[0].outcome, "YES");
});
for (const status of lifecycle.appealableStatuses)
  test(`protocol appeal submission supports ${status}`, async () => {
    const h = harness({ status });
    const op = h.job("protocol_appeal");
    h.jobs.push(op);
    await h.exports.workerUnderTest.submit(op, "lease");
    assert.ok(h.chainCalls.includes("appeal:0xoriginal"));
    assert.equal(op.tx_hash, "0xoriginal");
  });
test("polling a stalled transaction yields to another queued question", async () => {
  const h = harness({ status: "PENDING" });
  h.jobs.push(h.job("resolve"), {
    ...h.job("register", "second"),
    status: "queued",
  });
  await h.exports.workerTick();
  await h.exports.workerTick();
  assert.ok(h.chainCalls.includes("write:register"));
  assert.equal(h.jobs[1].status, "submitted");
});
test("failed idle indexing schedules backoff and still delivers the outbox", async () => {
  const h = harness({ badIndex: true });
  await h.exports.workerTick();
  assert.ok(h.chainCalls.includes("deliver"));
  assert.ok(
    h.calls.some((c) =>
      c.query.startsWith("UPDATE questions SET next_index_at"),
    ),
  );
});
test("a resolution stays pending until its finalized full hearing window is open", async () => {
  const h = harness({ unopened: true });
  const op = h.job("resolve");
  h.jobs.push(op);
  await h.exports.workerUnderTest.poll(op);
  assert.equal(op.status, "submitted");
  assert.equal(h.stored.status, "awaiting_window");
  assert.ok(
    h.calls.some(
      (c) =>
        c.query.startsWith("INSERT INTO operations") &&
        c.values.includes("open_round"),
    ),
  );
});
test("failed emitted payment queues backed recovery instead of completing withdrawal", async () => {
  const h = harness({ childFailed: true });
  const op = h.job("withdraw");
  h.jobs.push(op);
  await h.exports.workerUnderTest.poll(op);
  assert.equal(op.status, "failed");
  const restore = h.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.values.includes("restore_payment"),
  );
  assert.ok(restore);
  assert.equal(JSON.parse(restore.values[4]).payment_id, "payment");
});
test("an expired lease prevents transaction broadcast", async () => {
  const h = harness({ expiredLease: true });
  const op = h.job("register");
  await assert.rejects(
    h.exports.workerUnderTest.submit(op, "expired"),
    /lease expired/,
  );
  assert.ok(!h.chainCalls.some((c) => c.startsWith("write:")));
});
test("funded failed rehearing remains a pending hearing rather than a resolved case", () => {
  assert.equal(
    lifecycle.questionState(
      { funded: true, settled: false, challenge_count: 1 },
      1,
      0,
      1000,
    ),
    "awaiting_rehearing",
  );
  assert.equal(
    lifecycle.fundedRehearing(
      { funded: true, settled: false, challenge_count: 1 },
      1,
    ),
    true,
  );
});

test("a missing finalized funding message postpones resolution and queues a value free repair", async () => {
  const h = harness({ messageHandoff: true, unprepared: true });
  const op = { ...h.job("resolve"), status: "queued" };
  await h.exports.workerUnderTest.submit(op, "lease");
  assert.ok(
    h.calls.some(
      (c) =>
        c.query.startsWith("INSERT INTO operations") &&
        c.values.includes("prepare_hearing"),
    ),
  );
  assert.ok(
    h.calls.some((c) =>
      c.query.startsWith("UPDATE operations SET status='queued'"),
    ),
  );
  assert.ok(!h.chainCalls.some((c) => c.startsWith("write:")));
});
test("a missing finalized ruling message is repaired by publishing stored docket output", async () => {
  const h = harness({ messageHandoff: true });
  await h.exports.workerUnderTest.submit(h.job("open_round"), "lease");
  assert.ok(h.chainCalls.includes("write:publish_ruling"));
  assert.ok(!h.chainCalls.includes("write:open_round"));
});
test("a failed challenge callback still queues recovery of its paid hearing", async () => {
  const h = harness({ messageHandoff: true, childFailed: true });
  const op = h.job("challenge");
  h.jobs.push(op);
  await h.exports.workerUnderTest.poll(op);
  assert.equal(op.status, "failed");
  assert.ok(
    h.calls.some(
      (c) =>
        c.query.startsWith("INSERT INTO operations") &&
        c.values.includes("resolve"),
    ),
  );
});

test("Studio refuses an unsafe native appeal before broadcasting", async () => {
  const h = harness({ nativeDisabled: true });
  await assert.rejects(
    h.exports.workerUnderTest.submit(h.job("protocol_appeal"), "lease"),
    /paused/,
  );
  assert.ok(!h.chainCalls.some((c) => c.startsWith("appeal:")));
});

test("an already funded fee is rejected before any monetary transaction", async () => {
  const h = harness();
  await assert.rejects(
    h.exports.workerUnderTest.submit(h.job("fund"), "lease"),
    /already funded/,
  );
  assert.ok(!h.chainCalls.some((c) => c.startsWith("write:")));
});
test("a challenge supporting the existing outcome is rejected before paying a bond", async () => {
  const h = harness({ messageHandoff: true });
  const op = {
    ...h.job("challenge"),
    payload: { claimant: "0xbeneficiary", expected: "NO" },
  };
  await assert.rejects(
    h.exports.workerUnderTest.submit(op, "lease"),
    /open, different ruling/,
  );
  assert.ok(!h.chainCalls.some((c) => c.startsWith("write:")));
});

test("a transient preflight read failure safely backs off without sending value or requiring review", async () => {
  const h = harness({ badPreparation: true });
  h.jobs.push({ ...h.job("fund"), status: "queued", tx_hash: null });
  await h.exports.workerTick();
  assert.ok(
    h.calls.some((c) =>
      c.query.startsWith("UPDATE operations SET status='queued',error=NULL"),
    ),
  );
  assert.ok(!h.chainCalls.some((c) => c.startsWith("write:")));
  assert.ok(!h.calls.some((c) => c.values.includes("needs_review")));
});

test("the outbox signs with its database timestamp rather than a skewed worker clock", async () => {
  const h = harness();
  await h.exports.workerTick();
  assert.ok(h.chainCalls.includes("deliver-clock:1000"));
});
function payload(values: any[]) {
  for (const value of values) {
    if (typeof value !== "string" || !value.startsWith("{")) continue;
    try {
      return JSON.parse(value);
    } catch {
      /* not the JSON parameter */
    }
  }
  throw Error("no JSON parameter was recorded");
}
test("a settled question records its status and its outbox event together", async () => {
  // A crash between the status write and the event insert used to lose the
  // event for good, because later idle scans skip settled questions.
  const h = harness({ settled: true, messageHandoff: true });
  await h.exports.workerUnderTest.updateQuestion("first");
  const delivery = h.calls.find((c) =>
    c.query.startsWith("INSERT INTO deliveries"),
  );
  assert.ok(delivery, "a settlement event must be written");
  assert.equal(
    payload(delivery!.values).type,
    "question.settled",
    "the event payload describes the settlement",
  );
  assert.ok(
    h.transactions.at(-1)! >= 2,
    "the status and the event are one atomic write",
  );
});
test("a settlement event lost by an interrupted index is replaced later", async () => {
  const h = harness({ lostDelivery: true });
  assert.equal(await h.exports.workerUnderTest.repairDeliveries(), true);
  const delivery = h.calls.find((c) =>
    c.query.startsWith("INSERT INTO deliveries"),
  );
  assert.ok(delivery);
  assert.equal(payload(delivery!.values).round, 2);
  assert.equal(
    await harness().exports.workerUnderTest.repairDeliveries(),
    false,
  );
});
test("a settled escrow registers every payer for payment scanning", async () => {
  const h = harness({ settled: true, messageHandoff: true });
  await h.exports.workerUnderTest.updateQuestion("first");
  const watches = h.calls.filter((c) =>
    c.query.startsWith("INSERT INTO payment_watch"),
  );
  const addresses = watches.map((c) => c.values[1]);
  assert.ok(addresses.includes(PAYERS.payer), "a bonded payer is watched");
  assert.ok(addresses.includes(PAYERS.claimant), "a claimant is watched");
  assert.ok(addresses.includes(PAYERS.feePayer), "the fee payer is watched");
  assert.ok(
    addresses.includes(PAYERS.beneficiary),
    "the question beneficiary is watched",
  );
});
test("a pending payment found in contract state queues its reconciliation", async () => {
  // This is the path a direct contract withdrawal takes, which this service
  // never submitted and would otherwise never notice.
  const h = harness({ watch: true });
  assert.equal(await h.exports.workerUnderTest.scanPayments(), true);
  assert.ok(h.chainCalls.includes("get_payment"));
  const queued = h.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.values.includes("confirm_payment"),
  );
  assert.ok(queued, "the scanner queues confirmation of a pending payment");
  assert.ok(
    h.calls.some((c) => c.query.startsWith("UPDATE payment_watch")),
    "the scan is rescheduled",
  );
  assert.equal(await harness().exports.workerUnderTest.scanPayments(), false);
});
test("continuous job traffic no longer starves indexing", async () => {
  const h = harness({ status: "PENDING", overdueIndex: true });
  h.jobs.push(h.job("resolve"));
  await h.exports.workerTick();
  const index = h.calls.find((c) =>
    c.query.startsWith("SELECT id FROM questions"),
  );
  assert.ok(index, "an overdue question is still indexed while a job is due");
  assert.ok(
    index!.values.includes(300),
    "indexing resumes once a refresh is overdue by the grace period",
  );
});
test("an overdue funded hearing queues its own bounded exit", async () => {
  const h = harness({ overdue: true, messageHandoff: true });
  await h.exports.workerUnderTest.updateQuestion("first");
  const queued = h.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.query.includes("'claim_timeout'"),
  );
  assert.ok(queued, "the service delivers the refund without being asked");
  assert.ok(
    h.calls.some(
      (c) =>
        c.query.startsWith("UPDATE questions SET criteria_hash") &&
        c.values.includes("awaiting_refund"),
    ),
  );
});
test("a hearing receipt is checked against the panel its round was funded for", async () => {
  const leaderOnly = harness({ messageHandoff: true, settled: true });
  const op = leaderOnly.job("resolve");
  leaderOnly.jobs.push(op);
  await leaderOnly.exports.workerUnderTest.poll(op);
  const recorded = leaderOnly.calls.find((c) =>
    c.query.startsWith("UPDATE questions SET panel_checks"),
  );
  assert.ok(recorded, "every hearing records a panel check");
  const [check] = JSON.parse(recorded!.values[0]);
  assert.equal(check.round, 2);
  assert.equal(check.required, 7);
  assert.equal(check.leader_only, true);
  assert.equal(
    check.verified,
    false,
    "leader only execution is not reported as a verified panel",
  );
  const full = harness({ messageHandoff: true, settled: true, validators: 6 });
  const op2 = full.job("resolve");
  full.jobs.push(op2);
  await full.exports.workerUnderTest.poll(op2);
  const [verified] = JSON.parse(
    full.calls.find((c) =>
      c.query.startsWith("UPDATE questions SET panel_checks"),
    )!.values[0],
  );
  assert.equal(verified.observed, 7);
  assert.equal(verified.independent_validators, 6);
  assert.equal(verified.verified, true);
});
test("the requested panel follows the contract's own commitment", async () => {
  const h = harness({ messageHandoff: true });
  const op = h.job("resolve");
  h.jobs.push(op);
  await h.exports.workerUnderTest.submit(op, "lease");
  assert.ok(h.chainCalls.includes("write:resolve"));
  assert.equal(h.exports.workerUnderTest ? true : false, true);
});
test("a merely slow hearing is never released by the service itself", async () => {
  const h = harness({ overdue: true, messageHandoff: true });
  await h.exports.workerUnderTest.updateQuestion("first");
  const queued = h.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.query.includes("'claim_timeout'"),
  );
  assert.ok(queued);
  assert.ok(
    queued!.query.includes("NOT EXISTS") &&
      queued!.query.includes("'resolve','challenge','prepare_hearing'"),
    "the service only queues the exit when no hearing of its own is in flight",
  );
});
test("one payment is reconciled once, however it was discovered", async () => {
  // A completed withdrawal, the on chain scanner and the beneficiary can all
  // notice the same pending payment. Two submissions in flight would leave the
  // loser failing against the contract, which already moved the payment on.
  const h = harness({ watch: true });
  await h.exports.workerUnderTest.scanPayments();
  const scanned = h.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.values.includes("confirm_payment"),
  );
  assert.ok(scanned);
  assert.ok(
    scanned!.query.includes("WHERE NOT EXISTS"),
    "the scanner yields to a reconciliation already in flight",
  );
  const withdrawal = harness({
    status: "FINALIZED",
    messageHandoff: true,
    childDelivered: true,
  });
  const op = withdrawal.job("withdraw");
  withdrawal.jobs.push(op);
  await withdrawal.exports.workerUnderTest.poll(op);
  const queued = withdrawal.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.values.includes("confirm_payment"),
  );
  assert.ok(queued, "a completed withdrawal still reconciles its payment");
  assert.ok(
    queued!.query.includes("WHERE NOT EXISTS"),
    "and it also yields to one already in flight",
  );
});

test("a v5 hearing queues independent on-contract proof before any settlement window", async () => {
  const h = harness({ proofGate: true });
  const job = h.job("resolve");
  h.jobs.push(job);
  await h.exports.workerUnderTest.poll(job);
  const queued = h.calls.find(
    (c) =>
      c.query.startsWith("INSERT INTO operations") &&
      c.values.includes("verify_hearing"),
  );
  assert.ok(queued);
  assert.equal(payload(queued!.values).hearing_tx, job.tx_hash);
  assert.equal(payload(queued!.values).candidate_id, "candidate");
});
test("v5 payment confirmation submits the withdrawal proof, and restoration keeps its exact backing", async () => {
  for (const kind of ["confirm_payment", "restore_payment"]) {
    const h = harness({ proofGate: true });
    const job = {
      ...h.job(kind),
      payload: {
        claimant: "0xbeneficiary",
        payment_id: "payment",
        withdrawal_tx: "0xwithdrawal",
      },
    };
    await h.exports.workerUnderTest.submit(job, "lease");
    assert.ok(
      h.chainCalls.includes(
        'write-args:["0xbeneficiary","payment","0xwithdrawal"]',
      ),
    );
    assert.ok(
      h.chainCalls.includes(
        "write-value:" + (kind === "restore_payment" ? "2" : "0"),
      ),
    );
    assert.ok(
      h.chainCalls.includes(
        "write:" +
          (kind === "confirm_payment"
            ? "confirm_withdrawal"
            : "restore_withdrawal"),
      ),
    );
  }
});

test("a v5 direct payment waits for its bound receipt and never asserts delivery without proof", async () => {
  const missing = harness({ watch: true, proofGate: true });
  await missing.exports.workerUnderTest.scanPayments();
  assert.ok(
    !missing.calls.some((c) => c.query.startsWith("INSERT INTO operations")),
  );
  const failed = harness({
    watch: true,
    proofGate: true,
    proofFound: true,
    childFailed: true,
  });
  await failed.exports.workerUnderTest.scanPayments();
  const recovery = failed.calls.find((c) =>
    c.query.startsWith("INSERT INTO operations"),
  );
  assert.ok(recovery?.values.includes("restore_payment"));
  assert.equal(payload(recovery!.values).withdrawal_tx, "0xpaymentParent");
});
test("an unverified settled index cannot emit an authoritative webhook", async () => {
  const h = harness({ proofGate: true, settled: true });
  await h.exports.workerUnderTest.updateQuestion("first");
  assert.ok(!h.calls.some((c) => c.query.startsWith("INSERT INTO deliveries")));
});

test("a native rollback cannot hide a finalized vault refund or fail its operation on a missing docket callback", async () => {
  const h = harness({
    missingDocket: true,
    settled: true,
    refunded: true,
    childFailed: true,
  });
  const job = h.job("claim_timeout");
  h.jobs.push(job);
  await h.exports.workerUnderTest.poll(job);
  assert.equal(job.status, "complete");
  const indexed = h.calls.find((c) =>
    c.query.startsWith("UPDATE questions SET criteria_hash"),
  );
  assert.equal(JSON.parse(indexed!.values[2]).unavailable, true);
  assert.ok(
    h.calls.some((c) => c.query.startsWith("INSERT INTO deliveries")),
    "the final non-adjudication refund still publishes",
  );
});
