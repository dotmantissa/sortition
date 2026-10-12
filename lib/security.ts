import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { resolve4 } from "node:dns/promises";
import { isIP } from "node:net";
import { request } from "node:https";
import { env } from "./env";
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function encrypt(value: string) {
  const iv = randomBytes(12);
  const c = createCipheriv(
    "aes-256-gcm",
    Buffer.from(env("ENCRYPTION_KEY"), "hex"),
    iv,
  );
  const ciphertext = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ciphertext]).toString("base64");
}
export function decrypt(value: string) {
  const b = Buffer.from(value, "base64");
  const c = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(env("ENCRYPTION_KEY"), "hex"),
    b.subarray(0, 12),
  );
  c.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([c.update(b.subarray(28)), c.final()]).toString("utf8");
}
export function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function isPublicIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return false;
  const [a, b] = p;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0)
  );
}
export async function publicDestination(raw: string) {
  const u = new URL(raw);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443") ||
    isIP(u.hostname) ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".local")
  )
    throw new Error("Use a public HTTPS address");
  const ips = await resolve4(u.hostname);
  if (!ips.length || ips.some((ip) => !isPublicIPv4(ip)))
    throw new Error("Address must resolve to a public server");
  return { url: u, ip: ips[0] };
}
export async function deliverWebhook(
  raw: string,
  payload: string,
  secret: string,
  eventId: string,
  signingTimestamp: number,
) {
  if (!Number.isSafeInteger(signingTimestamp) || signingTimestamp <= 0)
    throw new Error("A trusted signing timestamp is required");
  const { url, ip } = await publicDestination(raw);
  const timestamp = signingTimestamp.toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${eventId}.${payload}`)
    .digest("hex");
  return new Promise<void>((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        timeout: 10000,
        lookup: (_host, _options, cb) => cb(null, ip, 4),
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          "Sortition-Signature": `t=${timestamp},v1=${signature}`,
          "Sortition-Event-Id": eventId,
        },
      },
      (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300)
          resolve();
        else reject(new Error("Webhook did not accept the delivery"));
      },
    );
    req.on("timeout", () => req.destroy(new Error("Webhook timed out")));
    req.on("error", reject);
    req.end(payload);
  });
}
