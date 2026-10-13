/**
 * Read only: confirm the deployed pages and public endpoints render the real
 * record. A substitute for the browser suite where Chromium's system libraries
 * are unavailable; it checks served markup rather than pixels.
 */
import nextEnv from "@next/env";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
nextEnv.loadEnvConfig(process.cwd());
const base = process.env.SORTITION_URL || "https://sortition.vercel.app";
const live = JSON.parse(readFileSync("deployments/live-test.json", "utf8"));
const exit = JSON.parse(readFileSync("deployments/live-exit.json", "utf8"));
async function page(path: string) {
  const response = await fetch(base + path, {
    headers: { "User-Agent": "sortition-verifier" },
  });
  assert.equal(response.status, 200, path);
  // React splits interpolated text with comment markers, and headings are
  // broken by inline tags, so compare against normalized visible text.
  return (await response.text())
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replaceAll("<!-- -->", "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
const home = await page("/");
for (const needle of [
  "A question deserves a fair hearing",
  "The docket",
  "Operator console",
]) {
  assert.ok(home.includes(needle), `home page shows: ${needle}`);
}
const docket = await page(`/dockets/${live.question_id}`);
for (const needle of [
  live.criteria_hash,
  live.docket_address,
  "Round 1",
  "Round 2",
  "Panel funded for 5, seated 5 with 4 independent validators",
  "Panel funded for 7, seated 7 with 6 independent validators",
  "The receipt meets the panel this round was funded for",
]) {
  assert.ok(docket.includes(needle), `docket page shows: ${needle}`);
}
assert.ok(
  docket.includes("iana.org") && docket.includes("mdn"),
  "the locked sources are published",
);
const refunded = await page(`/dockets/${exit.question_id}`);
assert.ok(
  refunded.includes("Refunded"),
  "a released hearing is published as refunded",
);
assert.ok(
  refunded.includes("went back to the account that paid it"),
  "the refund is explained rather than shown as a verdict",
);
const integrate = await page("/integrate");
assert.ok(integrate.length > 1000, "the integration guide renders");
console.log("Rendered pages verified at", base);
