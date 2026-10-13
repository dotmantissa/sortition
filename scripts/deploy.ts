/** Persist Studio transaction IDs immediately, then verify finalized execution. */
import nextEnv from "@next/env";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import {
  chain,
  object,
  statusName,
  executionSucceeded,
  publicReceipt,
} from "../lib/chain";
import type { TransactionHash } from "genlayer-js/types";
import {
  BURN_TREASURY,
  TERMS,
  resumability,
  archiveName,
  sourceHashes,
  type Manifest,
} from "../lib/deployment";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/studionet.json",
  client = chain();
function fresh(deployer: string): Manifest {
  return {
    network: "studionet",
    chain_id: 61999,
    deployer,
    treasury: BURN_TREASURY,
    ...TERMS,
    contracts: {},
  };
}
function save(state: Manifest) {
  writeFileSync(path + ".tmp", JSON.stringify(state, null, 2) + "\n");
  renameSync(path + ".tmp", path);
}
async function finalized(hash: string) {
  for (let i = 0; i < 180; i++) {
    let receipt;
    try {
      receipt = await client.getTransaction({ hash: hash as TransactionHash });
    } catch {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    const status = statusName(receipt);
    if (status === "FINALIZED") {
      writeFileSync(
        `deployments/${hash}.json`,
        JSON.stringify(publicReceipt(receipt), null, 2) + "\n",
      );
      if (!executionSucceeded(receipt))
        throw Error("Contract execution failed; inspect the public receipt.");
      console.log("Successful finalized transaction", hash);
      return receipt;
    }
    if (["UNDETERMINED", "CANCELED"].includes(status))
      throw Error("Network did not finalize deployment successfully.");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw Error(
    "Deployment polling timed out; resume using the saved transaction ID.",
  );
}

const deployer = client.account!.address;
const hashes = sourceHashes();
let state: Manifest = fresh(deployer);
if (existsSync(path)) {
  const recorded = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  const { resumable, reasons } = resumability(
    recorded,
    deployer,
    hashes,
    state.chain_id,
  );
  if (resumable) {
    state = recorded;
  } else if (recorded.submission_in_progress) {
    throw Error(
      `The recorded manifest has an unreconciled submission (${recorded.submission_in_progress}) and is not resumable here because ${reasons.join("; ")}. Reconcile it by hand before deploying.`,
    );
  } else {
    const archive = archiveName(recorded);
    writeFileSync(archive, JSON.stringify(recorded, null, 2) + "\n");
    console.log(
      `Archived the previous deployment record to ${archive} because ${reasons.join("; ")}. Deploying fresh contracts.`,
    );
    save(state);
  }
}
if (state.submission_in_progress)
  throw Error(
    "Reconcile the recorded deployment submission before running again.",
  );
for (const name of ["vault", "registry"] as const) {
  const entry = state.contracts[name] || {};
  const source = readFileSync(
    `contracts/${name === "vault" ? "settlement_vault" : "question_registry"}.py`,
    "utf8",
  );
  const docket = readFileSync("contracts/sortition_docket.py", "utf8");
  if (!entry.tx_hash) {
    state.submission_in_progress = name;
    save(state);
    const hash = await client.deployContract({
      code: source,
      args:
        name === "vault"
          ? [state.treasury || BURN_TREASURY]
          : [
              state.contracts.vault.address!,
              docket,
              state.appeal_window_seconds,
              state.relay_grace_seconds ?? TERMS.relay_grace_seconds,
              state.hearing_timeout_seconds ?? TERMS.hearing_timeout_seconds,
              state.max_bonded_rounds ?? TERMS.max_bonded_rounds,
            ],
    });
    entry.tx_hash = hash;
    entry.source_hash = hashes[name];
    if (name === "registry") entry.docket_source_hash = hashes.docket;
    state.contracts[name] = entry;
    delete state.submission_in_progress;
    save(state);
    console.log("Submitted", name, hash);
  }
  if (!entry.address) {
    const receipt = await finalized(entry.tx_hash);
    entry.address = (object(receipt).to_address ||
      object(receipt).contract_address) as `0x${string}`;
    save(state);
  }
  console.log("Verified", name, entry.address);
}
if (!state.configure_tx) {
  state.submission_in_progress = "configure";
  save(state);
  state.configure_tx = await client.writeContract({
    address: state.contracts.vault.address!,
    functionName: "configure",
    value: 0n,
    args: [state.contracts.registry.address!],
  });
  delete state.submission_in_progress;
  save(state);
}
if (!state.configured) {
  await finalized(state.configure_tx!);
  state.configured = true;
  save(state);
}
let environment = readFileSync(".env.local", "utf8").split("\n");
for (const [key, name] of [
  ["GENLAYER_REGISTRY_ADDRESS", "registry"],
  ["GENLAYER_VAULT_ADDRESS", "vault"],
]) {
  environment = environment.filter((line) => !line.startsWith(key + "="));
  environment.push(key + "=" + state.contracts[name].address);
}
writeFileSync(".env.local", environment.filter(Boolean).join("\n") + "\n", {
  mode: 0o600,
});
console.log(
  "Studio deployment verified and private host configuration updated.",
);
