import test from "node:test";
import assert from "node:assert/strict";
import {
  specificationSchema,
  registrationSchema,
  closingIsFuture,
} from "../../lib/validation";
const spec = {
  question: "Did the final official rate exceed five percent?",
  criteria: "YES above five percent. NO otherwise.",
  unresolvable_definition: "No final official release is available.",
  sources: [
    { name: "Source A", url: "https://a.example/result" },
    { name: "Source B", url: "https://b.example/result" },
  ],
  tie_break_url: "https://a.example/result",
  disagreement_rule: "unanimous",
  close_timestamp: 2000000000,
};
test("registration accepts a complete locked specification and exact integer fees", () => {
  assert.ok(
    registrationSchema.safeParse({
      specification: spec,
      fee: "0",
      base_bond: "1",
    }).success,
  );
});
test("sources must be unique, HTTPS, between two and five, and include the named tie source", () => {
  for (const change of [
    { sources: [spec.sources[0]] },
    { sources: [spec.sources[0], spec.sources[0]] },
    { tie_break_url: "https://other.example" },
    { sources: [spec.sources[0], { name: "B", url: "http://b.example" }] },
  ])
    assert.equal(
      specificationSchema.safeParse({ ...spec, ...change }).success,
      false,
    );
});
test("fees cannot contain decimals, signs, unsafe large numbers or zero bonds", () => {
  for (const change of [
    { fee: "-1" },
    { fee: "1.1" },
    { base_bond: "0" },
    { fee: "9".repeat(80) },
  ])
    assert.equal(
      registrationSchema.safeParse({ specification: spec, ...change }).success,
      false,
    );
});
test("closing timestamp gives enough time for registration", () => {
  assert.equal(closingIsFuture(100, 100000), false);
  assert.equal(closingIsFuture(131, 100000), false);
  assert.equal(closingIsFuture(160, 100000), true);
});

test("temporal clocks lock post-close observation and reject unsupported historical snapshots", () => {
  const baseline = {
    question: "Will the home team win this match?",
    criteria: "YES for a final home win after kickoff, NO otherwise.",
    unresolvable_definition: "No final score or abandoned match.",
    sources: [
      { name: "A", url: "https://a.example/score" },
      { name: "B", url: "https://b.example/score" },
    ],
    tie_break_url: "https://a.example/score",
    disagreement_rule: "unanimous",
    close_timestamp: 100,
  };
  const parsed = specificationSchema.parse({
    ...baseline,
    observation_timestamp: 200,
    resolution_timestamp: 300,
  });
  assert.equal(parsed.resolution_timestamp, 300);
  assert.equal(
    specificationSchema.safeParse({ ...baseline, observation_timestamp: 99 })
      .success,
    false,
  );
  assert.equal(
    specificationSchema.safeParse({
      ...baseline,
      observation_timestamp: 200,
      resolution_timestamp: 199,
    }).success,
    false,
  );
  assert.equal(
    specificationSchema.safeParse({
      ...baseline,
      evidence_mode: "historical_state",
    }).success,
    false,
  );
  assert.equal(
    specificationSchema.safeParse({
      ...baseline,
      evidence_mode: "historical_state",
      sources: baseline.sources.map((s) => ({
        ...s,
        content_sha256: "a".repeat(64),
      })),
    }).success,
    true,
  );
});
