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
  assert.equal(closingIsFuture(160, 100000), true);
});
