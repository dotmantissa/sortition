import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySortitionWebhook } from "../../integrations/verify-webhook";
test("consumer verifies exact body, signature and timestamp", () => {
  const body = '{"outcome":"YES"}',
    secret = "test secret",
    time = 1000;
  const sig = createHmac("sha256", secret)
    .update(`${time}.${body}`)
    .digest("hex");
  const header = `t=${time},v1=${sig}`;
  assert.equal(verifySortitionWebhook(body, header, secret, time), true);
  assert.equal(verifySortitionWebhook(body + " ", header, secret, time), false);
  assert.equal(verifySortitionWebhook(body, header, secret, 1400), false);
  assert.equal(verifySortitionWebhook(body, "bad", secret, time), false);
});
