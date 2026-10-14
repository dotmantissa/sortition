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
      {
        "name": "First authority",
        "url": "https://your-authority.example/result"
      },
      {
        "name": "Second authority",
        "url": "https://your-second-authority.example/result"
      }
    ],
    "tie_break_url": "https://your-authority.example/result",
    "disagreement_rule": "unanimous",
    "close_timestamp": 2000000000,
    "observation_timestamp": 2000007200,
    "resolution_timestamp": 2000007500,
    "evidence_mode": "event_outcome",
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

Actions are `fund`, `resolve`, `challenge`, `finalize`, `withdraw`, `claim_timeout`, `confirm_payment` and `open_round`. Native `protocol_appeal` requests return 409 on the current Studio deployment following a failed live rollback; use a bonded hearing. A challenge also requires `expected_outcome`, which is YES, NO or UNRESOLVABLE and must differ from the current result. A funded challenge queues the larger jury automatically.

Only `fund` is reserved for the question operator, because it is the operator's own payment and an unfunded question locks nothing. Resolution, settlement, release and challenge are open to any authenticated account, so an absent operator cannot obstruct a docket. `resolve` is accepted from a non operator once the registered relay's grace period after the close has expired, or for a rehearing that is already funded.

`claim_timeout` releases a funded hearing whose deadline passed without the ruling that round owes. Every bond returns to the account that paid it, the resolution fee returns to its funder, and the settlement becomes `REFUNDED`. It returns 409 while the hearing is still within its deadline or already has a ruling to finalize. The same call exists on the vault contract and needs no account here at all.

`withdraw` belongs to the caller's own beneficiary. It requires a stake in the escrow and real withdrawable credit, and it does not occupy the question's exclusive action slot. `confirm_payment` accepts delivery of your own pending payment, which unblocks your next withdrawal without waiting for the relay.

Bond credits belong to the economic payer. Sponsored bonds return to the relay; self funded winning bonds return to their payer. Losing bonds with no winning challenge, and resolution fees, are forfeited to the deployed treasury, which is an unspendable address rather than the relay. An authenticated docket read includes `self_funded_challenge`: the exact vault contract, function, arguments and value for posting a bond from your own wallet, so a dispute can carry a real personal stake.

Writes return an operation ID and queued status. An authenticated docket read includes your operations and their public transaction hashes. `needs_review` means submission was interrupted before a hash was durably recorded. Do not resubmit money until the relay history has been reconciled.

## Consume settlement

`GET /api/questions/:id/settlement` returns the final vault outcome or PENDING. Check `final`, the question ID and the locked criteria hash. Treat UNRESOLVABLE according to your venue's refund policy, and `REFUNDED` as a final non adjudication: the funded hearing passed its deadline, every payer was repaid and no verdict was reached. Polling is available across origins without exposing an API key.

The response also carries `as_of`, `index_age_seconds` and `stale`, because it is this service's indexed view of finalized contract state rather than a live read. A final settlement cannot change, so it is never marked stale however old its view is; `stale` is about a pending record whose indexing has fallen behind, and `panel_verified` with `panel_checks`, which compare each hearing's public receipt with the panel its round was funded for. Do not settle value on a record whose `panel_verified` is `false`.

Add `?attest=true` for an operator signed attestation. It is an EIP-191 signature over a newline separated statement of exactly these fields, in this order: `sortition.settlement.v1`, network, question ID, criteria hash, lowercased docket address, round count, outcome, `final` or `provisional`, and the issuing timestamp. An EVM contract can rebuild that string and recover the signer. It authenticates the publisher of the record; it does not prove GenLayer consensus to another chain, and it is not a bridge. Use `verifyAttestation` in `lib/attestation.ts` off chain.

## JSON RPC

`POST /api/rpc` accepts JSON RPC 2.0 requests. Methods are `sortition_getDocket`, `sortition_registerQuestion`, `sortition_resolve`, `sortition_challenge` and `sortition_finalize`. Read and action methods take `params.question_id`; registration takes the same payload as REST. The request ID is an idempotency fallback, so use a distinct ID for each intended write and preserve it during retries.

## Verify a webhook

Final settlements produce `question.settled`, including a released hearing, which carries `"outcome": "REFUNDED"` and `"refunded": true`. The headers contain `Sortition-Event-Id` and `Sortition-Signature: t=TIMESTAMP,v1=HEX_SIGNATURE`. Compute HMAC SHA256 over `TIMESTAMP + "." + EVENT_ID + "." + RAW_REQUEST_BODY` with your secret. Compare in constant time, reject timestamps older than five minutes and deduplicate both the authenticated event ID and the pinned settlement identity before applying the result.

Use [the verification helper](../integrations/verify-webhook.ts). Delivery retries use increasing delays and stop after ten attempts. No redirect is followed. Destinations are checked again at delivery and DNS is pinned for that request.

## Pin the consumer

Use the question ID, criteria hash, docket address and network that you registered. The shared `lib/settlement.ts` validator checks all four and rejects malformed or inconsistent final results. The Polymarket consumer adapter now requires these pins instead of accepting an unverified question ID alone.

Copy the widget together with `lib/settlement.ts`, or import both from a checked out integration package. Pass `criteriaHash`, `docketAddress` and `network` with `questionId`. The callback is a display notification, not durable financial processing. Store the settlement identity in your venue and apply it once.

The reference receiver at `/api/reference/settlement` verifies a configured signing secret, pinned criteria and finalized chain state. Its public GET record shows the action recorded for a question. It is an integration example, not a replacement for Polymarket's resolver or a bridge to another chain.

## Reviewer-safe settlement and recovery

The three timestamps separate trading cutoff, observation and earliest resolution. Omitted observation/resolution times explicitly inherit close and become part of the locked hash. Historical mode requires `content_sha256` on each authoritative versioned source and explicit dated evidence; a digest does not prove publication time.

A direct `resolve()` writes a candidate only. Submit `verify_hearing(candidate_id, tx_hash)` on the docket with the finalized hearing hash. Rejected candidates do not consume funding or open settlement. Public `docket.candidates` exposes pending/rejected attempts and their proof result; only verified hearings appear in `docket.rounds`. Until verification and the vault's final window complete, consumers receive PENDING. All final adjudications require `panel_verified === true`; absent verification must be rejected. REFUNDED is a non-adjudication exit.

For a direct withdrawal, `confirm_payment` optionally accepts `withdrawal_tx` in its action body. Contract calls are `confirm_withdrawal(beneficiary, payment_id, withdrawal_tx)` and payable `restore_withdrawal(beneficiary, payment_id, withdrawal_tx)` with exact replacement backing. Both independently check execution proof; supplying a hash does not assert success. The service can discover direct withdrawal receipts, but the beneficiary can always submit proof directly. Never retry an unresolved native transfer.
