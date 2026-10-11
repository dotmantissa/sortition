import test from "node:test";
import assert from "node:assert/strict";
import {
  isPublicIPv4,
  encrypt,
  decrypt,
  safeEqual,
  publicDestination,
} from "../../lib/security";
import {
  executionSucceeded,
  publicReceipt,
  statusName,
  childExecutionState,
} from "../../lib/chain";
import { isReadOnlyDatabaseRequest } from "../../lib/db";
process.env.ENCRYPTION_KEY = "ab".repeat(32);
test("webhooks reject private, loopback, metadata and reserved networks", () => {
  for (const ip of [
    "127.0.0.1",
    "10.2.3.4",
    "172.31.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.100.1.1",
    "224.0.0.1",
    "198.18.0.1",
    "bad",
  ])
    assert.equal(isPublicIPv4(ip), false, ip);
  assert.equal(isPublicIPv4("8.8.8.8"), true);
});
test("webhook secrets round trip under authenticated encryption and reject tampering", () => {
  const secret = "a private webhook signing secret";
  const encrypted = encrypt(secret);
  assert.ok(!encrypted.includes(secret));
  assert.equal(decrypt(encrypted), secret);
  const b = Buffer.from(encrypted, "base64");
  b[b.length - 1] ^= 1;
  assert.throws(() => decrypt(b.toString("base64")));
});
test("constant time comparison handles different lengths", () => {
  assert.equal(safeEqual("a", "a"), true);
  assert.equal(safeEqual("a", "b"), false);
  assert.equal(safeEqual("a", "aa"), false);
});
test("webhook destination rejects credentials, IP literals and unsupported protocols before lookup", async () => {
  for (const url of [
    "http://public.example",
    "https://127.0.0.1",
    "https://user:password@example.org",
    "https://example.org:8080",
    "https://localhost",
    "https://host.local",
  ])
    await assert.rejects(publicDestination(url));
});
test("finalized failed transactions never count as successful execution", () => {
  assert.equal(
    executionSucceeded({
      status: 7,
      consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] },
    }),
    false,
  );
  assert.equal(statusName({ status: 7 }), "FINALIZED");
  assert.equal(
    executionSucceeded({
      consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] },
    }),
    true,
  );
});
test("public receipts keep votes and evidence while excluding node credentials", () => {
  const r = publicReceipt({
    hash: "0xabc",
    status: 7,
    consensus_history: {
      rounds: [
        {
          node_config: { api_key: "secret" },
          api_token: "secret",
          votes: { "0x1": "agree" },
        },
      ],
    },
    consensus_data: {
      votes: { "0x1": "agree" },
      validators: [
        {
          vote: "agree",
          node_config: { address: "0x1", plugin_config: { api_key: "secret" } },
          eq_outputs: { source: "reading" },
          genvm_result: {
            stdout: JSON.stringify({
              sortition_evidence: {
                outcome: "YES",
                sources: [{ value: "200=ok" }],
              },
            }),
          },
        },
      ],
      leader_receipt: [
        { execution_result: "SUCCESS", node_config: { api_key: "secret" } },
      ],
    },
  });
  assert.equal(r.execution_success, true);
  assert.equal(JSON.stringify(r).includes("secret"), false);
  assert.equal(r.validators[0].address, "0x1");
  assert.deepEqual(r.validators[0].source_reads, [
    { outcome: "YES", sources: [{ value: "200=ok" }] },
  ]);
});

test("quorum cancellation on a late validator does not override the leader execution", () => {
  assert.equal(
    executionSucceeded({
      consensus_data: {
        leader_receipt: [
          { mode: "leader", execution_result: "SUCCESS" },
          { mode: "validator", execution_result: "ERROR" },
        ],
      },
    }),
    true,
  );
});

test("bonded hearings use strictly increasing random panel sizes", async () => {
  const { panelSize } = await import("../../lib/chain");
  assert.equal(panelSize(0), 5);
  assert.equal(panelSize(1), 7);
  assert.equal(panelSize(2), 9);
  assert.throws(() => panelSize(-1));
  assert.throws(() => panelSize(33));
});

test("emitted payments require successful final child receipts", () => {
  const contract = (status: number, execution: string) => ({
    status,
    type: 2,
    consensus_data: { leader_receipt: [{ execution_result: execution }] },
  });
  assert.equal(childExecutionState([contract(5, "SUCCESS")]), "pending");
  assert.equal(childExecutionState([contract(7, "ERROR")]), "failed");
  assert.equal(
    childExecutionState([contract(7, "SUCCESS"), contract(5, "SUCCESS")]),
    "pending",
  );
  assert.equal(
    childExecutionState([{ typeHex: 0, value_credited: true, status: 7 }]),
    "complete",
  );
  assert.equal(
    childExecutionState([{ typeHex: "0x0", value_credited: true, status: 7 }]),
    "complete",
  );
  assert.equal(
    childExecutionState([{ typeHex: 0, value_credited: false, status: 7 }]),
    "failed",
  );
  assert.equal(childExecutionState([{ typeHex: 0, status: 7 }]), "failed");
  assert.equal(
    publicReceipt({ typeHex: 0, status: 7, value_credited: true })
      .transaction_type,
    0,
  );
  assert.equal(childExecutionState([{ type: 0, status: 6 }]), "failed");
  assert.equal(
    executionSucceeded({ type: 0, status: 7, txExecutionResultName: "ERROR" }),
    false,
  );
  assert.equal(executionSucceeded({ type: 2, status: 7 }), false);
});

test("database retries exclude uncertain writes and mixed transactions", () => {
  assert.equal(
    isReadOnlyDatabaseRequest(
      JSON.stringify({ query: "SELECT id FROM questions" }),
    ),
    true,
  );
  assert.equal(
    isReadOnlyDatabaseRequest(
      JSON.stringify({
        queries: [{ query: "SELECT 1" }, { query: "select 2" }],
      }),
    ),
    true,
  );
  for (const query of [
    "UPDATE worker_lock SET lease_until=now()",
    "INSERT INTO operations VALUES(1)",
    "WITH inserted AS (DELETE FROM questions) SELECT 1",
  ])
    assert.equal(isReadOnlyDatabaseRequest(JSON.stringify({ query })), false);
  assert.equal(
    isReadOnlyDatabaseRequest(
      JSON.stringify({
        queries: [
          { query: "SELECT 1" },
          { query: "UPDATE deliveries SET attempts=attempts+1" },
        ],
      }),
    ),
    false,
  );
  assert.equal(isReadOnlyDatabaseRequest("invalid"), false);
});
