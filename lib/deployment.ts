/**
 * Deployment terms and the rules that decide whether a recorded manifest is
 * resumable state or a finished record. Kept free of side effects so scripts
 * and tests can import it without deploying anything.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** Forfeited bonds leave the relay for an address nobody can spend from. */
export const BURN_TREASURY = "0x000000000000000000000000000000000000dEaD";
/**
 * Studio terms. The hearing timeout is deliberately short so the bounded exit
 * is demonstrable on a development network; a production deployment should
 * choose a timeout well beyond its slowest expected hearing.
 */
export const TERMS = {
  appeal_window_seconds: 900,
  relay_grace_seconds: 900,
  hearing_timeout_seconds: 1800,
  max_bonded_rounds: 3,
};
export type Entry = {
  tx_hash?: string;
  address?: `0x${string}`;
  source_hash?: string;
  docket_source_hash?: string;
};
export type Manifest = {
  network: string;
  chain_id: number;
  deployer: string;
  treasury?: string;
  appeal_window_seconds: number;
  relay_grace_seconds?: number;
  hearing_timeout_seconds?: number;
  max_bonded_rounds?: number;
  contracts: Record<string, Entry>;
  configure_tx?: string;
  configured?: boolean;
  submission_in_progress?: string;
};
export function sourceHashes() {
  const read = (name: string) => readFileSync(name, "utf8");
  return {
    vault: createHash("sha256")
      .update(read("contracts/settlement_vault.py"))
      .digest("hex"),
    registry: createHash("sha256")
      .update(read("contracts/question_registry.py"))
      .digest("hex"),
    docket: createHash("sha256")
      .update(read("contracts/sortition_docket.py"))
      .digest("hex"),
  };
}
/**
 * A manifest is resumable deployment state only when it belongs to this
 * deployer, this network and the exact sources on disk. Anything else is a
 * finished deployment record: reusing it would skip the deployment and write
 * someone else's addresses into the configuration, where owner restricted
 * registration then fails.
 */
export function resumability(
  manifest: Manifest,
  deployer: string,
  hashes: { vault: string; registry: string; docket: string },
  chainId: number,
) {
  const reasons: string[] = [];
  if (manifest.deployer?.toLowerCase() !== deployer.toLowerCase())
    reasons.push(
      `it was deployed by ${manifest.deployer}, but this relay key is ${deployer}`,
    );
  if (manifest.chain_id !== chainId)
    reasons.push(
      `it targets chain ${manifest.chain_id}, but this endpoint is chain ${chainId}`,
    );
  const recorded = {
    vault: manifest.contracts?.vault?.source_hash,
    registry: manifest.contracts?.registry?.source_hash,
    docket: manifest.contracts?.registry?.docket_source_hash,
  };
  for (const name of ["vault", "registry", "docket"] as const) {
    const saved = recorded[name];
    if (saved && saved !== hashes[name])
      reasons.push(`the ${name} source changed since it was deployed`);
  }
  for (const [key, value] of Object.entries(TERMS))
    if (
      manifest[key as keyof Manifest] !== undefined &&
      manifest[key as keyof Manifest] !== value
    )
      reasons.push(
        `its ${key} is ${manifest[key as keyof Manifest]}, not ${value}`,
      );
  return { resumable: !reasons.length, reasons };
}
export function archiveName(manifest: Manifest) {
  const short = (manifest.contracts?.registry?.address || "unknown").slice(
    0,
    10,
  );
  return `deployments/superseded-${manifest.deployer?.slice(0, 10) || "unknown"}-${short}.json`;
}
