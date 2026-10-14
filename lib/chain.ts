import "./network";
import "./rpc-transport";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import { env } from "./env";
import { maxBondedRounds } from "./lifecycle";
export type Address = `0x${string}`;
export const minimumPanel = 5;
export const panelStep = 2;
/**
 * The panel a round is requested with. The contract commits the same number
 * when it authorizes the funded round, so an actual receipt can be checked
 * against it. GenLayer does not expose the seated panel to contract code, so
 * the contract gates ruling publication on a separate finalized receipt audit.
 */
export function panelSize(challengeCount: number) {
  if (
    !Number.isInteger(challengeCount) ||
    challengeCount < 0 ||
    challengeCount > maxBondedRounds
  )
    throw new Error("Invalid challenge round");
  return minimumPanel + panelStep * challengeCount;
}
/** Only the latest executing leader and completed unique voters count. */
function panelMembers(receipt: ReturnType<typeof publicReceipt>) {
  const leader = receipt.leaders.filter((l) => l.mode === "leader").at(-1);
  const members = new Map<string, (typeof receipt.validators)[number]>();
  const selfVote = receipt.leaders
    .filter(
      (l) =>
        l.mode === "validator" &&
        String(l.address).toLowerCase() ===
          String(leader?.address).toLowerCase(),
    )
    .at(-1);
  for (const member of [
    ...(leader ? [leader] : []),
    ...(selfVote ? [selfVote] : []),
    ...receipt.validators,
  ]) {
    if (
      typeof member.address !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(member.address) ||
      member.execution_result !== "SUCCESS" ||
      (member.mode !== "leader" &&
        !["agree", "disagree"].includes(String(member.vote)))
    )
      continue;
    members.set(member.address.toLowerCase(), member);
  }
  return { members, leader };
}
export function observedPanel(receipt: ReturnType<typeof publicReceipt>) {
  return panelMembers(receipt).members.size;
}
export function panelVerification(
  receipt: ReturnType<typeof publicReceipt>,
  required: number,
) {
  const { members, leader } = panelMembers(receipt);
  const observed = members.size;
  const independent = [...members].filter(
    ([address, m]) =>
      address !== String(leader?.address).toLowerCase() &&
      m.mode === "validator",
  ).length;
  const agreeing = [...members.values()].filter(
    (m) => m.vote === "agree",
  ).length;
  return {
    required,
    observed,
    independent_validators: independent,
    leader_only: independent === 0,
    agreeing,
    verified:
      receipt.status === "FINALIZED" &&
      receipt.execution_success &&
      required > 0 &&
      observed >= required &&
      independent > 0 &&
      agreeing > observed / 2,
  };
}
export function chain(panel = 5, signerKey?: Address) {
  const client = createClient({
    chain: {
      ...studionet,
      rpcUrls: {
        ...studionet.rpcUrls,
        default: { http: [...studionet.rpcUrls.default.http] },
      },
    },
    endpoint: process.env.GENLAYER_RPC_URL,
    account: createAccount(
      signerKey ?? (env("GENLAYER_PRIVATE_KEY") as Address),
    ),
  });
  client.chain.defaultNumberOfInitialValidators = panel;
  return client;
}
export function addresses() {
  return {
    registry: env("GENLAYER_REGISTRY_ADDRESS") as Address,
    vault: env("GENLAYER_VAULT_ADDRESS") as Address,
  };
}
export function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    ),
  );
}
export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function statusName(receipt: unknown) {
  const r = object(receipt);
  const s = r.statusName || r.status_name || r.status;
  return typeof s === "number"
    ? (
        {
          5: "ACCEPTED",
          7: "FINALIZED",
          6: "UNDETERMINED",
          8: "CANCELED",
        } as Record<number, string>
      )[s] || "PENDING"
    : String(s);
}
export function supplementStudioReceipt(decoded: unknown, raw: unknown) {
  const r = object(raw);
  return {
    ...object(decoded),
    typeHex: r.type ?? object(decoded).typeHex,
    value_credited: r.value_credited ?? object(decoded).value_credited,
  };
}
export async function readTransaction(hash: `0x${string}`) {
  const client = chain();
  const decoded = await client.getTransaction({
    hash: hash as import("genlayer-js/types").TransactionHash,
  });
  if (client.chain.isStudio && transactionType(decoded) === undefined) {
    // viem drops Studio's numeric zero type. Request its raw field for ledger proof.
    const raw = await client.request({
      method: "eth_getTransactionByHash",
      params: [hash],
    });
    return supplementStudioReceipt(decoded, raw);
  }
  return decoded;
}
export function transactionType(receipt: unknown) {
  const r = object(receipt),
    raw = r.typeHex ?? r.type;
  if (raw === "SEND") return 0;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 2
    ? value
    : undefined;
}
export function executionSucceeded(receipt: unknown) {
  const r = object(receipt);
  const c = object(r.consensus_data || r.consensusData);
  const leaders = c.leader_receipt || c.leaderReceipt;
  const l = object(
    Array.isArray(leaders)
      ? leaders.filter((v) => object(v).mode === "leader").at(-1) || leaders[0]
      : leaders,
  );
  return (
    l.execution_result === "SUCCESS" ||
    r.txExecutionResultName === "SUCCESS" ||
    r.tx_execution_result_name === "SUCCESS" ||
    // Studio native SEND transactions bypass GenVM and finalize after ledger credit.
    (transactionType(r) === 0 &&
      r.value_credited === true &&
      statusName(r) === "FINALIZED" &&
      l.execution_result !== "ERROR" &&
      r.txExecutionResultName !== "ERROR" &&
      r.tx_execution_result_name !== "ERROR")
  );
}
export function childExecutionState(
  receipts: unknown[],
): "pending" | "failed" | "complete" {
  if (
    receipts.some(
      (receipt) =>
        [
          "CANCELED",
          "UNDETERMINED",
          "LEADER_TIMEOUT",
          "VALIDATORS_TIMEOUT",
        ].includes(statusName(receipt)) ||
        (statusName(receipt) === "FINALIZED" && !executionSucceeded(receipt)),
    )
  )
    return "failed";
  return receipts.every((receipt) => statusName(receipt) === "FINALIZED")
    ? "complete"
    : "pending";
}
export function publicReceipt(receipt: unknown) {
  const r = object(jsonSafe(receipt));
  const c = object(r.consensus_data || r.consensusData);
  const mapReceipt = (raw: unknown) => {
    const v = object(raw),
      n = object(v.node_config),
      g = object(v.genvm_result);
    const evidence = String(g.stdout || "")
      .split("\n")
      .flatMap((line) => {
        try {
          const parsed = object(JSON.parse(line));
          return parsed.sortition_evidence ? [parsed.sortition_evidence] : [];
        } catch {
          return [];
        }
      });
    return {
      address: n.address,
      mode: v.mode,
      vote: v.vote,
      execution_result: v.execution_result,
      result: v.result,
      eq_outputs: v.eq_outputs,
      nondet_disagree: v.nondet_disagree,
      source_reads: evidence.length ? evidence : v.eq_outputs,
      stdout: g.stdout,
      stderr: g.stderr,
    };
  };
  const leaders = c.leader_receipt || c.leaderReceipt;
  return {
    hash: r.hash || r.txId,
    transaction_type: transactionType(r),
    value_credited: r.value_credited,
    value: r.value,
    sender: r.from_address || r.sender,
    recipient: r.to_address || r.recipient,
    status: statusName(r),
    execution_success: executionSucceeded(r),
    votes: c.votes,
    validators: Array.isArray(c.validators) ? c.validators.map(mapReceipt) : [],
    leaders: Array.isArray(leaders)
      ? leaders.map(mapReceipt)
      : leaders
        ? [mapReceipt(leaders)]
        : [],
    history: redactReceiptHistory(r.consensus_history),
    rotation_count: r.rotation_count,
    appealed: r.appealed,
    appeal_failed: r.appeal_failed,
    appeal_undetermined: r.appeal_undetermined,
    triggered_transactions: r.triggered_transactions,
  };
}
function redactReceiptHistory(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactReceiptHistory);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/secret|token|password|credential|private|api.?key|plugin_config/i.test(
            key,
          ),
      )
      .map(([key, v]) => [
        key,
        key === "node_config"
          ? {
              address:
                typeof object(v).address === "string"
                  ? object(v).address
                  : undefined,
            }
          : redactReceiptHistory(v),
      ]),
  );
}
export async function readFinal(
  address: Address,
  functionName: string,
  args: (string | number | bigint)[] = [],
) {
  return jsonSafe(
    await chain().readContract({
      address,
      functionName,
      args,
      transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
      jsonSafeReturn: true,
    }),
  );
}

let cachedClock: { unix: number; local: number } | null = null;
export async function networkClock() {
  const local = Date.now();
  if (cachedClock && local - cachedClock.local < 60000)
    return {
      unix: cachedClock.unix + Math.floor((local - cachedClock.local) / 1000),
      offset_seconds: cachedClock.unix - Math.floor(cachedClock.local / 1000),
    };
  const deployment = object(
    (await import("../deployments/studionet.json")).default,
  );
  const receipt = object(
    await chain().getTransaction({
      hash: deployment.configure_tx as import("genlayer-js/types").TransactionHash,
    }),
  );
  const unix = Number(receipt.current_timestamp || receipt.currentTimestamp);
  if (!Number.isSafeInteger(unix) || unix <= 0)
    throw new Error("Studio time is not available");
  cachedClock = { unix, local };
  return { unix, offset_seconds: unix - Math.floor(local / 1000) };
}

/** Find a direct withdrawal by its exact on-chain payment marker, never by amount alone. */
export async function withdrawalTransaction(
  vault: Address,
  beneficiary: string,
  paymentId: string,
) {
  const raw = await chain().request({
    method: "sim_getTransactionsForAddress",
    params: [vault],
  });
  if (!Array.isArray(raw)) return null;
  const candidates = raw
    .map(object)
    .filter(
      (r) =>
        String(r.to_address).toLowerCase() === vault.toLowerCase() &&
        statusName(r) === "FINALIZED" &&
        executionSucceeded(r),
    )
    .sort(
      (a, b) =>
        Date.parse(String(b.created_at)) - Date.parse(String(a.created_at)),
    )
    .slice(0, 100);
  for (const candidate of candidates) {
    for (const leader of publicReceipt(candidate)
      .leaders.filter((l) => l.mode === "leader")
      .slice(-1)) {
      for (const line of String(leader.stdout || "").split("\n")) {
        try {
          const marker = object(object(JSON.parse(line)).sortition_payment);
          if (
            marker.id === paymentId &&
            String(marker.beneficiary).toLowerCase() ===
              beneficiary.toLowerCase()
          )
            return String(candidate.hash) as Address;
        } catch {
          /* A receipt without a matching marker is not this payment. */
        }
      }
    }
  }
  return null;
}
