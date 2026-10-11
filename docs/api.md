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

Actions are `fund`, `resolve`, `challenge`, `finalize`, `withdraw` and `protocol_appeal`. A challenge also requires `expected_outcome`, which is YES, NO or UNRESOLVABLE and must differ from the current result. A funded challenge queues the larger jury automatically. Any email operator can challenge a public docket. Other application actions belong to its registered operator.

Writes return an operation ID and queued status. An authenticated docket read includes your operations and their public transaction hashes. `needs_review` means submission was interrupted before a hash was durably recorded. Do not resubmit money until the relay history has been reconciled.

## Consume settlement

`GET /api/questions/:id/settlement` returns the final vault outcome or PENDING. Check `final`, the question ID and the locked criteria hash. Treat UNRESOLVABLE according to your venue's refund policy. Polling is available across origins without exposing an API key.

## JSON RPC

`POST /api/rpc` accepts JSON RPC 2.0 requests. Methods are `sortition_getDocket`, `sortition_registerQuestion`, `sortition_resolve`, `sortition_challenge` and `sortition_finalize`. Read and action methods take `params.question_id`; registration takes the same payload as REST. The request ID is an idempotency fallback, so use a distinct ID for each intended write and preserve it during retries.

## Verify a webhook

Final settlements produce `question.settled`. The headers contain `Sortition-Event-Id` and `Sortition-Signature: t=TIMESTAMP,v1=HEX_SIGNATURE`. Compute HMAC SHA256 over `TIMESTAMP + "." + RAW_REQUEST_BODY` with your secret. Compare in constant time, reject timestamps older than five minutes and deduplicate the event ID before applying the result.

Use [the verification helper](../integrations/verify-webhook.ts). Delivery retries use increasing delays and stop after ten attempts. No redirect is followed. Destinations are checked again at delivery and DNS is pinned for that request.
