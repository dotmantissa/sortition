# Integrating a market

Create an API key from an email account in the operator console. Use it only on your server. Public docket and settlement reads require no authentication.

## Register a question

Send `POST /api/questions` with `Authorization: Bearer YOUR_API_KEY`, `Content-Type: application/json` and a unique `Idempotency-Key`.

```json
{
  "specification": {
    "question": "Your complete question",
    "criteria": "What counts as YES and what counts as NO",
    "sources": [
      { "name": "First authority", "url": "https://your-authority.example/result" },
      { "name": "Second authority", "url": "https://your-second-authority.example/result" }
    ],
    "tie_break_url": "https://your-authority.example/result",
    "disagreement_rule": "unanimous",
    "close_timestamp": 2000000000,
    "unresolvable_definition": "No final result, conflicting evidence, or an unavailable source"
  },
  "fee": "0",
  "base_bond": "1"
}
```

Replace every example value with your actual criteria and public sources. This is a payload shape, not a usable market. Fees and bonds are integer GEN wei. Optional venue metadata is hashed with the specification. Registration returns HTTP 202 with `id` and `operation_id`. Poll `GET /api/questions/:id` for the fingerprint and docket address.

For webhooks, add `webhook: { url, secret }` beside the specification. The URL must be public HTTPS and the secret must have at least 24 characters. Source and webhook destinations are checked before registration.

## Request an action

Send `POST /api/questions/:id/actions` with the same authentication and a new idempotency key.

```json
{ "action": "resolve" }
```

Actions are `fund`, `resolve`, `challenge`, `finalize`, `withdraw` and `open_round`. Native `protocol_appeal` requests return 409 on the current Studio deployment following a failed live rollback; use a bonded hearing. A challenge also requires `expected_outcome`, which is YES, NO or UNRESOLVABLE and must differ from the current result. A funded challenge queues the larger jury automatically. Any email operator can challenge a public docket. Fee, initial resolution and finalization actions belong to the registered operator. A participant can retry an already funded rehearing. The worker opens the full application challenge window after protocol finality; `open_round` can retry that preparation. Bond credits belong to the economic payer. Sponsored bonds return to the relay; self funded winning bonds return to their payer. Losing bonds with no winning challenge are forfeited to treasury.

Writes return an operation ID and queued status. An authenticated docket read includes your operations and their public transaction hashes. `needs_review` means submission was interrupted before a hash was durably recorded. Do not resubmit money until the relay history has been reconciled.

## Consume settlement

`GET /api/questions/:id/settlement` returns the final vault outcome or PENDING. Check `final`, the question ID and the locked criteria hash. Treat UNRESOLVABLE according to your venue's refund policy. Polling is available across origins without exposing an API key.

## JSON RPC

`POST /api/rpc` accepts JSON RPC 2.0 requests. Methods are `sortition_getDocket`, `sortition_registerQuestion`, `sortition_resolve`, `sortition_challenge` and `sortition_finalize`. Read and action methods take `params.question_id`; registration takes the same payload as REST. The request ID is an idempotency fallback, so use a distinct ID for each intended write and preserve it during retries.

## Verify a webhook

Final settlements produce `question.settled`. The headers contain `Sortition-Event-Id` and `Sortition-Signature: t=TIMESTAMP,v1=HEX_SIGNATURE`. Compute HMAC SHA256 over `TIMESTAMP + "." + EVENT_ID + "." + RAW_REQUEST_BODY` with your secret. Compare in constant time, reject timestamps older than five minutes and deduplicate both the authenticated event ID and the pinned settlement identity before applying the result.

Use [the verification helper](../integrations/verify-webhook.ts). Delivery retries use increasing delays and stop after ten attempts. No redirect is followed. Destinations are checked again at delivery and DNS is pinned for that request.

## Pin the consumer

Use the question ID, criteria hash, docket address and network that you registered. The shared `lib/settlement.ts` validator checks all four and rejects malformed or inconsistent final results. The Polymarket consumer adapter now requires these pins instead of accepting an unverified question ID alone.

Copy the widget together with `lib/settlement.ts`, or import both from a checked out integration package. Pass `criteriaHash`, `docketAddress` and `network` with `questionId`. The callback is a display notification, not durable financial processing. Store the settlement identity in your venue and apply it once.

The reference receiver at `/api/reference/settlement` verifies a configured signing secret, pinned criteria and finalized chain state. Its public GET record shows the action recorded for a question. It is an integration example, not a replacement for Polymarket's resolver or a bridge to another chain.
