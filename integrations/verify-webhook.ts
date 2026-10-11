import { createHmac, timingSafeEqual } from "node:crypto";
/** Verify against the raw request body, then deduplicate Sortition-Event-Id. */
export function verifySortitionWebhook(
  rawBody: string,
  header: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
) {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(header);
  if (!match || Math.abs(now - Number(match[1])) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${match[1]}.${rawBody}`)
    .digest();
  return timingSafeEqual(expected, Buffer.from(match[2], "hex"));
}
