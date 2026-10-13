/** Read only: confirm deployed code and published terms match this source. */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { chain, readFinal, object } from "../lib/chain";
import { BURN_TREASURY, TERMS, sourceHashes } from "../lib/deployment";
nextEnv.loadEnvConfig(process.cwd());
const manifest = JSON.parse(readFileSync("deployments/studionet.json", "utf8"));
const hashes = sourceHashes();
const client = chain();
for (const [name, expected] of [
  ["vault", hashes.vault],
  ["registry", hashes.registry],
] as const) {
  const address = manifest.contracts[name].address;
  const code = (await client.request({
    method: "gen_getContractCode",
    params: [address],
  })) as string;
  // gen_getContractCode returns the deployed source base64 encoded.
  const raw = code.startsWith("0x")
    ? Buffer.from(code.slice(2), "hex").toString("utf8")
    : Buffer.from(code, "base64").toString("utf8");
  const onChain = createHash("sha256").update(raw).digest("hex");
  assert.equal(onChain, expected, `${name} code must match this source`);
  assert.equal(manifest.contracts[name].source_hash, expected);
  console.log("verified deployed source", name, address, onChain.slice(0, 16));
}
assert.equal(manifest.contracts.registry.docket_source_hash, hashes.docket);
const terms = object(
  await readFinal(manifest.contracts.registry.address, "get_terms"),
);
assert.equal(terms.appeal_window, TERMS.appeal_window_seconds);
assert.equal(terms.relay_grace, TERMS.relay_grace_seconds);
assert.equal(terms.hearing_timeout, TERMS.hearing_timeout_seconds);
assert.equal(terms.max_rounds, TERMS.max_bonded_rounds);
assert.equal(terms.docket_code_hash, hashes.docket);
assert.equal(
  String(terms.vault).toLowerCase(),
  manifest.contracts.vault.address.toLowerCase(),
);
const configuration = object(
  await readFinal(manifest.contracts.vault.address, "get_configuration"),
);
assert.equal(configuration.configured, true);
assert.equal(
  String(configuration.registry).toLowerCase(),
  manifest.contracts.registry.address.toLowerCase(),
);
assert.equal(
  String(configuration.treasury).toLowerCase(),
  BURN_TREASURY.toLowerCase(),
  "forfeited value must leave the relay",
);
assert.equal(
  String(configuration.relay).toLowerCase(),
  String(terms.relay).toLowerCase(),
);
assert.notEqual(
  String(configuration.treasury).toLowerCase(),
  String(configuration.relay).toLowerCase(),
  "the treasury must not be the relay",
);
console.log("published terms", JSON.stringify(terms));
console.log("vault configuration", JSON.stringify(configuration));
console.log("Deployed code and published terms match this source tree.");
