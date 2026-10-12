# Sortition

A fair hearing for every market question.

[Open Sortition](https://sortition.vercel.app)

Prediction markets put a price on an opinion. Someone still has to decide what actually happened. Sortition gives that decision a public home: a question, a locked set of sources, rules written before the close, and a jury selected by GenLayer.

There is no exchange here. No positions, no liquidity pool, and no house view. An operator brings a market question and takes a final verdict back to their own venue.

## What you can do

Register a question through the email console or API. Lock two to five named sources, choose how disagreements are handled, name a tie source, and write down when the honest answer is unresolvable. Each question gets its own contract address and public docket.

Request a resolution after the question closes. Every validator fetches every registered source and independently extracts the facts. Consensus checks the answer, the intermediate readings, source availability, global uncertainty conditions and every stored evidence field. The record includes evidence digests, quotations, jury receipts and votes.

Challenge a reading with a bond. Bonds double each round and the requested jury grows from 5 to 7 to 9 validators. GenLayer chooses the participants. Native protocol appeals are paused on this Studio deployment after a rollback failed live verification. Bonded hearings remain available. A fresh application challenge window starts after the ruling is final.

Consume a final settlement through REST, JSON RPC, a signed webhook, or the React widget. Unresolvable is a normal outcome. Your venue decides what to refund when the agreed evidence cannot settle the question.

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

The worker processes durable jobs from Neon. Leaving the page does not lose a submitted action. Registration waits for the factory and vault messages to finish. Fees and bonds are sponsored by the server relay within explicit payment and daily limits. Sponsored bond proceeds return to the relay. The claimant cannot turn a free hearing into a withdrawal. A funded relay is needed for nonzero amounts.

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
npx tsx scripts/verify-payout.ts
npx tsx scripts/verify-service.ts
```

Direct tests cover all three contracts, including permission checks, locked hashes, every disagreement rule, missing evidence, malformed model replies, validator comparison, escalating bonds, settlement boundaries and payouts. Test fixtures are confined to the test suite.

The live test registers a real IANA and MDN question on Studio, verifies the factory docket and criteria hash, funds the fee, resolves independently fetched evidence, challenges the result, checks the larger panel and finalizes settlement. The payout verification then checks actual native value delivery and zero remaining credit. It keeps resumable public progress in `deployments/live-test.json`.

## Connect a venue

Create an API key in the console and keep it on your venue's server. Send a bearer token and a unique `Idempotency-Key` with each write. See [the API guide](docs/api.md) for payloads and webhook verification.

The [Polymarket adapter](integrations/polymarket.ts) imports real question data through the public Gamma API. The [worked reference](deployments/polymarket-reference.json) records a real venue question registered through the production API. It registers a separate Sortition docket for that question. It does not replace Polymarket's existing resolver. Add the remaining authoritative sources and review the imported criteria before registration.

Copy [SortitionResolution](components/SortitionResolution.tsx) with [the settlement validator](lib/settlement.ts) into a React application to show a final settlement and link to the full docket. Pin the criteria hash, docket address and network. The widget rejects inconsistent finality, clears the previous question immediately and avoids duplicate callbacks during its mounted lifetime. Your venue must persist its own settlement identity before applying payouts.

## Deployment

A [complete Studio docket](https://sortition.vercel.app/dockets/c6df7b42-6413-47da-9e25-b8e7335bca94) records two real source readings, a bonded hearing, final settlement and a verified native payment.

The current Studio addresses and verified transaction hashes are in [the deployment record](deployments/studionet.json). The registry factory deploys the docket contract for every question. Earlier deployments are kept as history.

The Next.js application can run on Vercel or any Node host. Set server environment variables through the host's secret manager. Run `scripts/worker.ts` as a persistent process, or call the authenticated worker endpoint from a scheduler. A sample systemd unit is included in [operations notes](docs/operations.md). The installed worker runs under systemd with user lingering enabled. A scheduled GitHub Actions worker also calls the production endpoint using an encrypted repository secret.

An API response alone is not a trustless bridge to another chain. A market contract must use a verified GenLayer state bridge or its own authenticated oracle before making payouts. Studio uses test GEN and is intended for development.

For dependency maintenance and secret handling, read [security notes](docs/security.md).

For the consensus boundary and settlement policy, read [the architecture notes](docs/architecture.md).
