import { Agent, fetch as request } from "undici";

const reads = new Set([
  "gen_call",
  "sim_getAllValidators",
  "sim_getTransactionsForAddress",
  "gen_getContractSchema",
  "eth_call",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_blockNumber",
  "eth_chainId",
  "eth_getCode",
]);
const dispatcher = new Agent({ connect: { family: 4, timeout: 15000 } });
const original = globalThis.fetch;
// The SDK uses global fetch internally. Limit this transport to the configured RPC.
globalThis.fetch = (async (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => {
  const endpoint =
    process.env.GENLAYER_RPC_URL || "https://studio.genlayer.com/api";
  if (String(input) !== endpoint || init?.method !== "POST")
    return original(input, init);
  let method = "";
  try {
    method = JSON.parse(String(init.body)).method;
  } catch {
    return original(input, init);
  }
  const attempts = reads.has(method) ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await request(endpoint, {
        ...init,
        dispatcher,
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
      } as Parameters<typeof request>[1]);
      if (!response.ok) throw Error("RPC service unavailable");
      if (reads.has(method)) await response.clone().json();
      return response as unknown as Response;
    } catch {
      if (attempt === attempts - 1)
        throw Error(
          reads.has(method)
            ? "RPC read unavailable"
            : "RPC submission response was not confirmed",
        );
    }
  }
  throw Error("RPC service unavailable");
}) as typeof fetch;
