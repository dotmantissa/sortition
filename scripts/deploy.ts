/** Persist Studio transaction IDs immediately, then verify finalized execution. */
import nextEnv from "@next/env";
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  chain,
  object,
  statusName,
  executionSucceeded,
  publicReceipt,
} from "../lib/chain";
import type { TransactionHash } from "genlayer-js/types";
nextEnv.loadEnvConfig(process.cwd());
const path = "deployments/studionet.json",
  client = chain();
type Entry = {
  tx_hash?: string;
  address?: `0x${string}`;
  source_hash?: string;
  docket_source_hash?: string;
};
const state: {
  network: string;
  chain_id: number;
  deployer: string;
  appeal_window_seconds: number;
  contracts: Record<string, Entry>;
  configure_tx?: string;
  configured?: boolean;
  submission_in_progress?: string;
} = existsSync(path)
  ? JSON.parse(readFileSync(path, "utf8"))
  : {
      network: "studionet",
      chain_id: 61999,
      deployer: client.account!.address,
      appeal_window_seconds: 900,
      contracts: {},
    };
function save() {
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
if (state.submission_in_progress)
  throw Error(
    "Reconcile the recorded deployment submission before running again.",
  );
for (const name of ["vault", "registry"]) {
  const entry = state.contracts[name] || {};
  const source = readFileSync(
    `contracts/${name === "vault" ? "settlement_vault" : "question_registry"}.py`,
    "utf8",
  );
  const docket = readFileSync("contracts/sortition_docket.py", "utf8");
  if (!entry.tx_hash) {
    state.submission_in_progress = name;
    save();
    const hash = await client.deployContract({
      code: source,
      args:
        name === "vault"
          ? [client.account!.address]
          : [
              state.contracts.vault.address!,
              docket,
              state.appeal_window_seconds,
            ],
    });
    entry.tx_hash = hash;
    entry.source_hash = createHash("sha256").update(source).digest("hex");
    if (name === "registry")
      entry.docket_source_hash = createHash("sha256")
        .update(docket)
        .digest("hex");
    state.contracts[name] = entry;
    delete state.submission_in_progress;
    save();
    console.log("Submitted", name, hash);
  }
  if (!entry.address) {
    const receipt = await finalized(entry.tx_hash);
    entry.address = (object(receipt).to_address ||
      object(receipt).contract_address) as `0x${string}`;
    save();
  }
  console.log("Verified", name, entry.address);
}
if (!state.configure_tx) {
  state.submission_in_progress = "configure";
  save();
  state.configure_tx = await client.writeContract({
    address: state.contracts.vault.address!,
    functionName: "configure",
    value: 0n,
    args: [state.contracts.registry.address!],
  });
  delete state.submission_in_progress;
  save();
}
if (!state.configured) {
  await finalized(state.configure_tx!);
  state.configured = true;
  save();
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
