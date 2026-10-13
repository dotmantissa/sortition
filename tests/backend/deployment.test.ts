import test from "node:test";
import assert from "node:assert/strict";
import {
  resumability,
  archiveName,
  BURN_TREASURY,
  TERMS,
  type Manifest,
} from "../../lib/deployment";

const DEPLOYER = "0x" + "1a".repeat(20);
const HASHES = { vault: "v".repeat(64), registry: "r".repeat(64), docket: "d".repeat(64) };
function manifest(overrides: Partial<Manifest> = {}): Manifest {
  return {
    network: "studionet",
    chain_id: 61999,
    deployer: DEPLOYER,
    treasury: BURN_TREASURY,
    ...TERMS,
    contracts: {
      vault: { tx_hash: "0x1", address: "0xv", source_hash: HASHES.vault },
      registry: {
        tx_hash: "0x2",
        address: "0xr",
        source_hash: HASHES.registry,
        docket_source_hash: HASHES.docket,
      },
    },
    configure_tx: "0x3",
    configured: true,
    ...overrides,
  };
}
test("a manifest from this deployer and these exact sources is resumable", () => {
  const { resumable, reasons } = resumability(
    manifest(),
    DEPLOYER.toUpperCase(),
    HASHES,
    61999,
  );
  assert.equal(resumable, true);
  assert.deepEqual(reasons, []);
});
test("another operator's deployment record is never resumed as state", () => {
  // This is the fresh installation failure: resuming would skip deployment and
  // write the original deployer's addresses into the configuration, where
  // owner restricted registration then fails.
  const { resumable, reasons } = resumability(
    manifest(),
    "0x" + "9b".repeat(20),
    HASHES,
    61999,
  );
  assert.equal(resumable, false);
  assert.match(reasons.join(" "), /deployed by/);
});
test("changed contract sources are not silently reused", () => {
  for (const [name, hashes] of [
    ["vault", { ...HASHES, vault: "0".repeat(64) }],
    ["registry", { ...HASHES, registry: "0".repeat(64) }],
    ["docket", { ...HASHES, docket: "0".repeat(64) }],
  ] as const) {
    const { resumable, reasons } = resumability(
      manifest(),
      DEPLOYER,
      hashes,
      61999,
    );
    assert.equal(resumable, false, name);
    assert.match(reasons.join(" "), new RegExp(`${name} source changed`));
  }
});
test("a record from another chain or with different terms is not resumable", () => {
  assert.equal(
    resumability(manifest(), DEPLOYER, HASHES, 42).resumable,
    false,
  );
  assert.match(
    resumability(
      manifest({ hearing_timeout_seconds: 99999 }),
      DEPLOYER,
      HASHES,
      61999,
    ).reasons.join(" "),
    /hearing_timeout_seconds/,
  );
});
test("an unfinished submission is still reported, never skipped", () => {
  // A manifest that is both foreign and mid submission must stop the operator
  // rather than quietly start again.
  const recorded = manifest({ submission_in_progress: "registry" });
  const { resumable } = resumability(
    recorded,
    "0x" + "9b".repeat(20),
    HASHES,
    61999,
  );
  assert.equal(resumable, false);
  assert.equal(recorded.submission_in_progress, "registry");
});
test("a superseded record is archived under its own deployer and registry", () => {
  const name = archiveName(manifest());
  assert.match(name, /^deployments\/superseded-0x1a1a1a1a-0xr\.json$/);
  assert.match(
    archiveName({ ...manifest(), contracts: {} } as Manifest),
    /unknown/,
  );
});
test("the treasury is an address nobody can spend from", () => {
  assert.equal(BURN_TREASURY.toLowerCase().endsWith("dead"), true);
  assert.ok(TERMS.hearing_timeout_seconds > TERMS.appeal_window_seconds);
  assert.ok(TERMS.max_bonded_rounds >= 1 && TERMS.max_bonded_rounds <= 8);
});
