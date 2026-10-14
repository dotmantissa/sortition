# Sortition

A fair hearing for every market question.

[Open Sortition](https://sortition.vercel.app)

Prediction markets put a price on an opinion. Someone still has to decide what actually happened. Sortition gives that decision a public home: a question, a locked set of sources, rules written before the close, and a jury selected by GenLayer.

There is no exchange here. No positions, no liquidity pool, and no house view. An operator brings a market question and takes a final verdict back to their own venue.

## What you can do

Register a question through the email console or API. Lock two to five named sources, choose how disagreements are handled, name a tie source, and write down when the honest answer is unresolvable. Each question gets its own contract address and public docket.

Request resolution after the locked resolution time. Trading close, event observation and resolution readiness are separate timestamps, so a post-close final score can establish the outcome. Every participant retrieves the sources independently. Extraction quotes are located in the source; a second audit inspects complete documents, temporal provenance, corrections and uncertainty. Oversized partial documents cannot produce conclusive verdicts. Historical mode locks source snapshot hashes and still requires dated historical support.

Every hearing first becomes a candidate. `verify_hearing` independently checks its finalized Studio receipt inside contract consensus before the docket can publish a ruling to escrow. Undersized direct juries are rejected, remain publicly visible and leave the funded round retryable with its original timeout. Required completed panels grow 5, 7, 9 and 11; the relay requests extra seats within the live validator pool to accommodate quorum completion. Native protocol appeals remain distinct from bonded application challenges and paused in the service after the documented Studio rollback failure.

Native payment confirmation likewise requires independent proof of the finalized parent and its actual transfer child. A relay assertion cannot mark a failed payment delivered. Recovery requires a proven failed transfer and exact native backing, and successful transfers cannot be restored or replayed.

Get your money back if the jury never answers. Every funded hearing carries a deadline. Once it passes with no ruling, anyone can release the docket and every fee and bond returns to the account that paid it, as the final outcome `REFUNDED`. No relay, no operator and no further consensus is required.

Consume a final settlement through REST, JSON RPC, a signed webhook, or the React widget. Unresolvable and refunded are both normal outcomes. Your venue decides what to refund when the agreed evidence cannot settle the question.

## Run it locally

Use Node 22 and Python 3.12 or newer. The installed GenLayer test tools require a recent Python runtime.

```sh
npm ci --legacy-peer-deps
python3 -m pip install -r requirements.txt
cp .env.example .env.local
chmod 600 .env.local
```

Fill in the local environment file. The public Privy app ID belongs in the browser. The app secret, database URL, relay key, encryption key and worker secret belong on the server. Generate independent random 32 byte values for the encryption key and worker secret. The encryption key is hexadecimal.

```sh
npm run db:migrate
npm run deploy:contracts
npm run dev
```

Run the worker in a second terminal:

```sh
npm run worker
```

The worker processes durable jobs from Neon. Leaving the page does not lose a submitted action. Registration waits for the factory and vault messages to finish. Fees and bonds are sponsored by the server relay within explicit payment and daily limits, and a losing sponsored bond is forfeited to a treasury address nobody can spend from, so a free hearing cannot become a withdrawal. A sponsored bond still costs the challenger nothing personally, so the console also publishes the exact vault call for posting a bond from your own wallet. A funded relay is needed for nonzero sponsored amounts.

## Verify the contracts

```sh
for contract in contracts/*.py; do genvm-lint check "$contract"; done
python3 -m pytest tests/direct -v
npm test
npm run lint
npm run typecheck
npm run build
npm run test:browser
npm run test:live
npm run test:exit
npm run test:escalation
npm run test:rendered
npm run test:remediation
npm run test:venue
npm run test:review
npx tsx scripts/verify-payout.ts
npx tsx scripts/verify-service.ts
npx tsx scripts/verify-deployment.ts
```

The reviewer suite adds direct undersized juries, receipt binding/finality/rotation/replay attacks, false payment confirmation, failed transfer recovery, post-close outcomes, historical corrections, incomplete documents and escrow recovery with a missing docket. Direct tests cover all three contracts, including permission checks, locked hashes, every disagreement rule, absent versus temporarily unavailable sources, quotation binding and support, malformed model replies, validator comparison, escalating bonds, bounded rounds, committed panels, relay rotation, settlement boundaries, refunds and payouts. Test fixtures are confined to the test suite.

The live test registers a real IANA and MDN question on Studio, verifies the factory docket and criteria hash, funds the fee, resolves independently fetched evidence, challenges the result, checks each hearing against the panel its round was funded for, finalizes settlement and confirms the losing bond left the relay for the burn treasury. The exit test proves the other ending: it funds a hearing, never asks for it, waits out the deadline, releases it permissionlessly, and verifies the exact refund arrives as native value and that the beneficiary can confirm delivery without the relay. Both keep resumable public progress in `deployments/live-test.json` and `deployments/live-exit.json`. The escalation test walks one docket through every bonded round this deployment allows, checking that each round commits the escalating panel on chain, recording what each panel actually seated, and confirming the round limit is refused on chain rather than by the service. `verify-deployment.ts` re-reads the deployed contract code and compares it with this working tree. `verify-rendered.ts` asserts the served markup of the public pages, which is what runs where Chromium's system libraries are unavailable; `npm run test:browser` is the fuller Playwright suite. The remediation verifier also proves distinct sponsor accounting, signed consumer delivery, duplicate handling and rejection of altered event IDs. Its test API keys are confined to a private local file and revoked after verification. These server integration checks do not claim to verify an email inbox.

## Connect a venue

Create an API key in the console and keep it on your venue's server. Send a bearer token and a unique `Idempotency-Key` with each write. See [the API guide](docs/api.md) for payloads and webhook verification.

The [Polymarket adapter](integrations/polymarket.ts) imports real question data through the public Gamma API. The [worked reference](deployments/polymarket-consumer.json) records a real venue question, finalized uncertainty verdict and verified refund action in the signed reference consumer. One registered source lacks final score values, so the agreed uncertainty rule requires a refund. Both records come from ESPN; this example does not claim separate publishers. It registers a separate Sortition docket for that question. It does not replace Polymarket's existing resolver. Add the remaining authoritative sources and review the imported criteria before registration.

Copy [SortitionResolution](components/SortitionResolution.tsx) with [the settlement validator](lib/settlement.ts) into a React application to show a final settlement and link to the full docket. Pin the criteria hash, docket address and network. The widget rejects inconsistent finality, clears the previous question immediately and avoids duplicate callbacks during its mounted lifetime. Your venue must persist its own settlement identity before applying payouts.

## Deployment

A [complete Studio docket](https://sortition.vercel.app/dockets/a1452539-47cf-4bbd-9e14-18cc0fa739ff) records two real source readings, a bonded hearing, final settlement and a verified native payment.

The current Studio addresses and verified transaction hashes are in [the deployment record](deployments/studionet.json). The registry factory deploys the docket contract for every question. Earlier deployments are kept as history.

The Next.js application can run on Vercel or any Node host. Set server environment variables through the host's secret manager. Run `scripts/worker.ts` as a persistent process, or call the authenticated worker endpoint from a scheduler. A sample systemd unit is included in [operations notes](docs/operations.md). The installed worker runs under systemd with user lingering enabled. A scheduled GitHub Actions worker also calls the production endpoint using an encrypted repository secret.

## What this project has not demonstrated

These are boundaries, not pending work items, and they are stated here so no
reader has to infer them.

- **No trustless bridge.** `GET /api/questions/:id/settlement?attest=true`
  returns an operator signed statement that an EVM contract can check with
  `ecrecover`. It authenticates _the publisher_, not GenLayer consensus. A
  market contract that moves real money needs a verified GenLayer state bridge
  or light client; this project does not provide one.
- **No external venue settlement.** The reference consumer records one decision
  per question in its own ledger. It does not hold, pay or alter a Polymarket
  position, and it does not replace Polymarket's resolver.
- **Production consensus is unproven.** Studio uses test GEN and supports
  leader only execution. Panel requirements are committed on chain and every
  finalized receipt is independently checked on contract before ruling publication. This fixed Studio RPC oracle is not a cryptographic inclusion proof; a jury security claim needs validation on
  the intended production network.
- **Sponsored bonds are not economic deterrence.** A challenger using the
  hosted console risks none of their own money. The contract supports genuinely
  user funded bonds and the console publishes the exact call, but the deterrence
  claim needs real user funded bonds in production.
- **Public reads are indexed state.** Every settlement response carries `as_of`,
  `index_age_seconds` and `stale`, so a lagging view is visible rather than
  silent. A direct on chain action can be newer than the indexed record.

Studio uses test GEN and is intended for development.

For dependency maintenance and secret handling, read [security notes](docs/security.md).

For the consensus boundary and settlement policy, read [the architecture notes](docs/architecture.md).

The current reviewer remediation and reproducible finalized scenarios are documented in [review evidence](docs/review-evidence.md). Older live scripts and records are retained as historical evidence; `npm run test:review` is the current acceptance suite.
