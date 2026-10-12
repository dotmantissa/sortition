/* eslint-disable @typescript-eslint/no-explicit-any -- indexed records cross an untyped API boundary in these tests. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  settlementStatement,
  attest,
  verifyAttestation,
  attestationDisclaimer,
} from "../../lib/attestation";
import {
  settlementView,
  panelVerified,
  indexAge,
  stalenessSeconds,
} from "../../lib/public-settlement";
import { parseSettlement } from "../../lib/settlement";
import type { Question } from "../../lib/types";

const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SIGNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const settlement = {
  question_id: "q-1",
  outcome: "YES" as const,
  final: true,
  criteria_hash: "a".repeat(64),
  docket_address: "0x" + "d1".repeat(20),
  network: "studionet",
  rounds: 2,
};
function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    specification: {} as any,
    criteria_hash: "a".repeat(64),
    docket_address: "0x" + "d1".repeat(20),
    status: "settled",
    fee: "0",
    base_bond: "1",
    created_at: new Date().toISOString(),
    indexed_at: new Date().toISOString(),
    docket: { rounds: [{ round: 1 }, { round: 2 }] as any },
    escrow: {
      funded: true,
      settled: true,
      outcome: "YES",
      challenge_count: 1,
      challenges: [],
    },
    ...overrides,
  };
}
test("a settlement attestation authenticates the publisher of an exact record", async (t) => {
  process.env.GENLAYER_PRIVATE_KEY = KEY;
  const issued = 1_900_000_000;
  const attestation = await attest(settlement, issued);
  assert.equal(attestation.signer, SIGNER);
  assert.equal(attestation.scheme, "eip191-secp256k1");
  assert.equal(attestation.disclaimer, attestationDisclaimer);
  assert.ok(
    await verifyAttestation(attestation, {
      signer: SIGNER,
      settlement,
      now: issued + 60,
    }),
  );
  await t.test("a changed verdict breaks the signature", async () => {
    assert.equal(
      await verifyAttestation(attestation, {
        signer: SIGNER,
        settlement: { ...settlement, outcome: "NO" },
        now: issued + 60,
      }),
      false,
    );
  });
  await t.test("another signer is rejected", async () => {
    assert.equal(
      await verifyAttestation(attestation, {
        signer: "0x" + "9".repeat(40),
        settlement,
        now: issued + 60,
      }),
      false,
    );
  });
  await t.test("a stale or future attestation is rejected", async () => {
    for (const now of [issued + 100000, issued - 1000])
      assert.equal(
        await verifyAttestation(attestation, { signer: SIGNER, settlement, now }),
        false,
      );
  });
  await t.test("a tampered statement is rejected", async () => {
    assert.equal(
      await verifyAttestation(
        { ...attestation, statement: attestation.statement + "x" },
        { signer: SIGNER, settlement, now: issued + 60 },
      ),
      false,
    );
  });
});
test("the signed statement is rebuildable field by field", () => {
  const statement = settlementStatement(settlement, 42);
  assert.deepEqual(statement.split("\n"), [
    "sortition.settlement.v1",
    "studionet",
    "q-1",
    "a".repeat(64),
    settlement.docket_address.toLowerCase(),
    "2",
    "YES",
    "final",
    "42",
  ]);
});
test("the public record always states how old its indexed view is", () => {
  const now = Date.now();
  const fresh = settlementView(question(), now);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.index_age_seconds, 0);
  assert.equal(fresh.outcome, "YES");
  assert.equal(fresh.final, true);
  const lagging = settlementView(
    question({
      indexed_at: new Date(now - (stalenessSeconds + 60) * 1000).toISOString(),
    }),
    now,
  );
  assert.equal(lagging.stale, true);
  assert.ok(lagging.index_age_seconds! > stalenessSeconds);
  assert.equal(indexAge(question({ indexed_at: "not a date" }), now), null);
});
test("a refunded hearing is published as a final non adjudication", () => {
  const view = settlementView(
    question({
      status: "refunded",
      docket: { rounds: [] },
      escrow: {
        funded: true,
        settled: true,
        refunded: true,
        outcome: "REFUNDED",
        challenge_count: 0,
        challenges: [],
      },
    }),
  );
  assert.equal(view.outcome, "REFUNDED");
  assert.equal(view.final, true);
  assert.equal(view.refunded, true);
  assert.equal(view.rounds, 0);
  // A consumer validator accepts it, and rejects a refund flag that disagrees.
  const parsed = parseSettlement(view, { questionId: "q-1" });
  assert.equal(parsed.outcome, "REFUNDED");
  assert.throws(
    () => parseSettlement({ ...view, refunded: false }, { questionId: "q-1" }),
    /Refund finality/,
  );
  // A completed hearing that also claims to be a refund is contradictory.
  assert.throws(
    () =>
      parseSettlement(
        { ...view, outcome: "YES", refunded: true, rounds: 2 },
        { questionId: "q-1" },
      ),
    /Refund finality/,
  );
});
test("panel verification requires every round to meet its funded panel", () => {
  const checks = [
    { round: 1, verified: true },
    { round: 2, verified: true },
  ] as any;
  assert.equal(panelVerified(checks, 2), true);
  assert.equal(panelVerified(checks, 3), false, "an unchecked round fails");
  assert.equal(
    panelVerified([{ round: 1, verified: true }, { round: 2, verified: false }] as any, 2),
    false,
  );
  assert.equal(panelVerified([], 1), false);
  assert.equal(panelVerified(undefined, 0), null, "nothing heard yet");
});
test("an unverified panel is published with the settlement", () => {
  const view = settlementView(
    question({
      panel_checks: [
        {
          round: 1,
          tx_hash: "0x1",
          required: 5,
          observed: 1,
          independent_validators: 0,
          leader_only: true,
          verified: false,
        },
        {
          round: 2,
          tx_hash: "0x2",
          required: 7,
          observed: 7,
          independent_validators: 6,
          leader_only: false,
          verified: true,
        },
      ],
    }),
  );
  assert.equal(view.panel_verified, false);
  assert.equal(view.panel_checks.length, 2);
});
