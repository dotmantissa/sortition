import "./network";
import "./rpc-transport";
import { createClient, createAccount } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionHashVariant } from "genlayer-js/types";
import { env } from "./env";
export type Address = `0x${string}`;
export function panelSize(challengeCount: number) {
  if (
    !Number.isInteger(challengeCount) ||
    challengeCount < 0 ||
    challengeCount > 32
  )
    throw new Error("Invalid challenge round");
  return 5 + 2 * challengeCount;
}
export function chain(panel = 5) {
  const client = createClient({
    chain: {
      ...studionet,
      rpcUrls: {
        ...studionet.rpcUrls,
        default: { http: [...studionet.rpcUrls.default.http] },
      },
    },
    endpoint: process.env.GENLAYER_RPC_URL,
    account: createAccount(env("GENLAYER_PRIVATE_KEY") as Address),
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
    ((r.type === 0 || r.type === "SEND") &&
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
        ["CANCELED", "UNDETERMINED"].includes(statusName(receipt)) ||
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
          !/secret|token|password|credential|private|api.?key|node_config|plugin_config/i.test(
            key,
          ),
      )
      .map(([key, v]) => [key, redactReceiptHistory(v)]),
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
