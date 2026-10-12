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
  "\nexport const workerUnderTest={poll,submit,updateQuestion};";
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
function harness(
  options: {
    status?: string;
    badIndex?: boolean;
    childFailed?: boolean;
    unopened?: boolean;
    expiredLease?: boolean;
    messageHandoff?: boolean;
    unprepared?: boolean;
    nativeDisabled?: boolean;
  } = {},
) {
  const calls: { query: string; values: any[] }[] = [],
    chainCalls: string[] = [],
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
      return [{ registry_address: "0xregistry", vault_address: "0xvault" }];
    if (query.startsWith("SELECT id FROM questions"))
      return options.badIndex ? [{ id: "bad" }] : [];
    if (query.startsWith("SELECT d.*"))
      return [
        {
          id: "event",
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
  sql.transaction = async (values: any[]) => Promise.all(values);
  const exports: any = {};
  const fakeClient = {
    account: { address: "0xrelay" },
    chain: { isStudio: true },
    getTriggeredTransactionIds: async () =>
      options.childFailed ? ["0xchild"] : [],
    getTransaction: async () => ({ statusName: options.status || "ACCEPTED" }),
    getBalance: async () => 100000n,
    appealTransaction: async () => {
      chainCalls.push("appeal:0xoriginal");
      return "0xoriginal";
    },
    writeContract: async (args: any) => {
      chainCalls.push("write:" + args.functionName);
      return "0xnew";
    },
  };
  const fakeChain = {
    ...helpers,
    networkClock: async () => ({ unix: 1000 }),
    chain: () => fakeClient,
    readTransaction: async (hash: string) => {
      chainCalls.push(hash);
      return {
        statusName:
          hash === "0xchild" ? "FINALIZED" : options.status || "FINALIZED",
        consensus_data: {
          leader_receipt: [
            {
              mode: "leader",
              execution_result: hash === "0xchild" ? "ERROR" : "SUCCESS",
            },
          ],
        },
      };
    },
    readFinal: async (_a: string, method: string) => {
      chainCalls.push(method);
      if (options.badIndex) throw Error("unavailable old question");
      if (method === "get_question")
        return {
          docket_address: "0xdocket",
          criteria_hash: "hash",
          specification: { close_timestamp: 0 },
        };
      if (method === "get_docket")
        return {
          funded: !options.unprepared,
          expected_challenge_count: options.unprepared ? 0 : 1,
          rounds: [
            { round: 1, outcome: "YES" },
            { round: 2, outcome: "NO" },
          ],
        };
      if (method === "get_settlement") return { round: 2, outcome: "NO" };
      if (method === "get_payment")
        return { id: "payment", amount: "2", status: "pending" };
      return {
        version: options.messageHandoff ? 3 : 2,
        funded: true,
        settled: false,
        challenge_count: 1,
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
              : name === "./sponsorship"
                ? { reserveSponsorship: async () => {} }
                : name === "./security"
                  ? {
                      decrypt: () => "secret",
                      deliverWebhook: async () => {
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
