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
  } = {},
) {
  const calls: string[] = [];
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
          escrow: {
            version: 2,
            opened_round: 1,
            funded: true,
            settled: false,
            challenge_count: options.pending ? 1 : 0,
          },
          docket: { rounds: [{}] },
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
    if (q.includes("SELECT count")) return [{ count: 30 }];
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
                      networkClock: async () => ({ unix: 1000 }),
                      addresses: () => ({ vault: "0xvault" }),
                    }
                  : m === "./security"
                    ? {
                        digest: (s: string) =>
                          crypto.createHash("sha256").update(s).digest("hex"),
                      }
                    : {},
  });
  return { exports, calls };
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
test("initial resolution remains an operator action", async () => {
  const h = service();
  await assert.rejects(
    h.exports.queueAction(
      { id: "challenger", beneficiary: "0xwallet" },
      "q",
      "resolve",
      undefined,
      "new",
    ),
    (e: HttpError) => e.status === 403,
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
