import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySortitionWebhook } from "../../integrations/verify-webhook";
test("consumer verifies exact body, signature and timestamp", () => {
  const body = '{"outcome":"YES"}',
    secret = "test secret",
    time = 1000,
    eventId = "event-1";
  const sig = createHmac("sha256", secret)
    .update(`${time}.${eventId}.${body}`)
    .digest("hex");
  const header = `t=${time},v1=${sig}`;
  assert.equal(
    verifySortitionWebhook(body, header, secret, eventId, time),
    true,
  );
  assert.equal(
    verifySortitionWebhook(body + " ", header, secret, eventId, time),
    false,
  );
  assert.equal(
    verifySortitionWebhook(body, header, secret, eventId, 1400),
    false,
  );
  assert.equal(
    verifySortitionWebhook(body, header, secret, "tampered-event", time),
    false,
  );
  assert.equal(
    verifySortitionWebhook(body, "bad", secret, eventId, time),
    false,
  );
});
