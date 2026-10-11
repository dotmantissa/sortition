import "./network";
import { neon, neonConfig } from "@neondatabase/serverless";
import { Agent, fetch as resilientFetch } from "undici";
import { env } from "./env";
// Database transport gets a longer connect timeout for Neon cold starts.
const dispatcher = new Agent({
  connect: { timeout: 30000, family: 4 },
  headersTimeout: 30000,
});
neonConfig.fetchFunction = (async (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await resilientFetch(String(input), {
        ...init,
        dispatcher,
      } as Parameters<typeof resilientFetch>[1])) as unknown as Response;
    } catch (error) {
      const code = (error as { cause?: { code?: string } })?.cause?.code;
      if (
        attempt >= 2 ||
        ![
          "UND_ERR_CONNECT_TIMEOUT",
          "ENETUNREACH",
          "ETIMEDOUT",
          "ECONNRESET",
          "EAI_AGAIN",
        ].includes(code || "")
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
