import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { env } from "./env";
import type { Settlement } from "./settlement";

/**
 * An operator signed statement about indexed GenLayer state.
 *
 * This is an oracle attestation, not a bridge. It lets a foreign chain or
 * venue authenticate that *this operator* published this settlement, using
 * ordinary ecrecover over an EIP-191 message, instead of trusting an
 * unauthenticated HTTPS body. It does not prove GenLayer consensus to another
 * chain: a consumer that needs that must verify GenLayer state through its own
 * bridge or light client. See docs/architecture.md.
 */
export type Attestation = {
  scheme: "eip191-secp256k1";
  signer: `0x${string}`;
  issued_at: number;
  statement: string;
  statement_hash: string;
  signature: `0x${string}`;
  disclaimer: string;
};
export const attestationDisclaimer =
  "Operator signed statement about indexed GenLayer state. Authenticates the publisher, not GenLayer consensus.";
export function settlementStatement(
  settlement: Pick<
    Settlement,
    | "question_id"
    | "outcome"
    | "final"
    | "criteria_hash"
    | "docket_address"
    | "network"
    | "rounds"
  >,
  issuedAt: number,
) {
  // A compact, order fixed statement so a Solidity verifier can rebuild it.
  return [
    "sortition.settlement.v1",
    settlement.network,
    settlement.question_id,
    settlement.criteria_hash ?? "",
    (settlement.docket_address ?? "").toLowerCase(),
    String(settlement.rounds),
    settlement.outcome,
    settlement.final ? "final" : "provisional",
    String(issuedAt),
  ].join("\n");
}
export function attestationSigner() {
  return privateKeyToAccount(env("GENLAYER_PRIVATE_KEY") as `0x${string}`);
}
export async function attest(
  settlement: Parameters<typeof settlementStatement>[0],
  issuedAt: number,
): Promise<Attestation> {
  const account = attestationSigner();
  const statement = settlementStatement(settlement, issuedAt);
  return {
    scheme: "eip191-secp256k1",
    signer: account.address,
    issued_at: issuedAt,
    statement,
    statement_hash: createHash("sha256").update(statement).digest("hex"),
    signature: await account.signMessage({ message: statement }),
    disclaimer: attestationDisclaimer,
  };
}
/** Verify an attestation against an expected signer. Used by consumers. */
export async function verifyAttestation(
  attestation: Attestation,
  expected: {
    signer: string;
    settlement: Parameters<typeof settlementStatement>[0];
    maximumAgeSeconds?: number;
    now?: number;
  },
) {
  if (
    attestation?.scheme !== "eip191-secp256k1" ||
    typeof attestation.signature !== "string" ||
    typeof attestation.statement !== "string"
  )
    return false;
  if (attestation.signer?.toLowerCase() !== expected.signer.toLowerCase())
    return false;
  if (
    attestation.statement !==
    settlementStatement(expected.settlement, attestation.issued_at)
  )
    return false;
  const now = expected.now ?? Math.floor(Date.now() / 1000);
  const age = now - Number(attestation.issued_at);
  if (
    !Number.isSafeInteger(Number(attestation.issued_at)) ||
    age < -300 ||
    age > (expected.maximumAgeSeconds ?? 900)
  )
    return false;
  return verifyMessage({
    address: attestation.signer,
    message: attestation.statement,
    signature: attestation.signature,
  });
}
