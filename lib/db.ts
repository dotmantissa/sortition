import "./network";
import { neon, neonConfig } from "@neondatabase/serverless";
import { Agent, fetch as resilientFetch } from "undici";
import { env } from "./env";
export function isReadOnlyDatabaseRequest(body: unknown) {
  try {
    const parsed = JSON.parse(String(body));
    const queries = Array.isArray(parsed.queries) ? parsed.queries : [parsed];
    return (
      queries.length > 0 &&
      queries.every(
        (q: { query?: unknown }) =>
          typeof q.query === "string" && /^\s*SELECT\b/i.test(q.query),
      )
    );
  } catch {
    return false;
  }
}
// Database transport gets a longer connect timeout for Neon cold starts.
const dispatcher = new Agent({
  connect: { timeout: 30000, family: 4 },
  headersTimeout: 30000,
});
neonConfig.fetchFunction = (async (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => {
  const retryReads = isReadOnlyDatabaseRequest(init?.body);
  for (let attempt = 0; ; attempt++) {
    try {
      return (await resilientFetch(String(input), {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(15000),
        dispatcher,
      } as Parameters<typeof resilientFetch>[1])) as unknown as Response;
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (
        !retryReads ||
        attempt >= 2 ||
        (![
          "UND_ERR_CONNECT_TIMEOUT",
          "UND_ERR_HEADERS_TIMEOUT",
          "UND_ERR_SOCKET",
          "ENETUNREACH",
          "ETIMEDOUT",
          "ECONNRESET",
          "EAI_AGAIN",
        ].includes(code || "") &&
          !(error instanceof Error && error.name === "TimeoutError"))
      )
        throw error;
    }
  }
}) as typeof fetch;
export function db() {
  const url = env("DATABASE_URL");
  neonConfig.fetchEndpoint = `https://${new URL(url).hostname}/sql`;
  return neon(url);
}
