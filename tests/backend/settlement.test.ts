import test from "node:test";
import assert from "node:assert/strict";
import { parseSettlement, settlementIdentity } from "../../lib/settlement";
const pin = {
  questionId: "q",
  criteriaHash: "a".repeat(64),
  docketAddress: "0x" + "b".repeat(40),
  network: "studionet",
};
const final = {
  question_id: "q",
  criteria_hash: pin.criteriaHash,
  docket_address: pin.docketAddress,
  network: pin.network,
  outcome: "YES",
  final: true,
  panel_verified: true,
  rounds: 2,
};
test("pinned settlement rejects wrong question, criteria, contract, chain and inconsistent finality", () => {
  for (const change of [
    { question_id: "other" },
    { criteria_hash: "c".repeat(64) },
    { docket_address: "0x" + "c".repeat(40) },
    { network: "other" },
    { final: "true" },
    { final: true, outcome: "PENDING" },
    { final: false },
    { rounds: 0 },
    { rounds: 1.5 },
  ])
    assert.throws(() => parseSettlement({ ...final, ...change }, pin));
  assert.equal(parseSettlement(final, pin).outcome, "YES");
  assert.equal(
    parseSettlement(
      {
        ...final,
        final: false,
        outcome: "PENDING",
        rounds: 0,
        criteria_hash: null,
        docket_address: null,
      },
      pin,
    ).final,
    false,
  );
});
test("a settlement identity binds the exact consumer decision and lock", () => {
  assert.equal(
    settlementIdentity(final as Parameters<typeof settlementIdentity>[0]),
    settlementIdentity({
      ...final,
      docket_address: pin.docketAddress.toUpperCase(),
    } as Parameters<typeof settlementIdentity>[0]),
  );
  assert.notEqual(
    settlementIdentity(final as Parameters<typeof settlementIdentity>[0]),
    settlementIdentity({ ...final, outcome: "NO" } as Parameters<
      typeof settlementIdentity
    >[0]),
  );
});

test("every external consumer rejects absent, false or stale jury verification", () => {
  for (const panel_verified of [undefined, false, null, "true"])
    assert.throws(
      () => parseSettlement({ ...final, panel_verified }, pin),
      /jury/,
    );
  assert.throws(() => parseSettlement({ ...final, stale: true }, pin), /stale/);
  assert.equal(
    parseSettlement(
      {
        ...final,
        outcome: "REFUNDED",
        refunded: true,
        rounds: 0,
        panel_verified: false,
      },
      pin,
    ).outcome,
    "REFUNDED",
  );
});
