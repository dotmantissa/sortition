# Reviewer remediation: verified version 5 / Studio deployment v9

All assertions below refer to actual finalized transactions and finalized contract state. The complete resumable record is [reviewer-v9.json](../deployments/reviewer-v9.json), with source hashes in [studionet.json](../deployments/studionet.json). Earlier deployments remain historical.

The web sources are **explicitly synthetic acceptance fixtures**, hosted by this project and labeled in every document. They demonstrate real nondeterministic retrieval and validator execution, not real football events, independent publishers, Polymarket adoption or external position payouts.

## Authority and temporal cases

| Scenario | Contract jury result | Final vault result | Hearing and proof transactions |
|---|---|---|---|
| event | verified; 8 completed / 5 required | YES | [0xcd83e7a09b…](https://explorer-studio.genlayer.com/tx/0xcd83e7a09b2e0a857eaa9ab4a75bf97336c58b87750915a514288957868c50fc); [0xec7abb2fdb…](https://explorer-studio.genlayer.com/tx/0xec7abb2fdb01aeb36c85611236c87b2c510f586eec9ccdfd6c18933f59241b81) |
| historical | verified; 5 completed / 5 required | UNRESOLVABLE | [0xd0538b0c9d…](https://explorer-studio.genlayer.com/tx/0xd0538b0c9df2dadda5ad8adb12e6ed600b414448f7d2059481de9d8e9455e977); [0x91ba37dc03…](https://explorer-studio.genlayer.com/tx/0x91ba37dc03777f2816f2a599ce5e36b1bdfe6640889bce7691231b6e465ff295) |
| incomplete | verified; 6 completed / 5 required | UNRESOLVABLE | [0x930d99d9da…](https://explorer-studio.genlayer.com/tx/0x930d99d9da87f7ed605f4a4c8df52eec4131d784c623bc365f31068b7ee4d13d); [0xdd53e8c0b0…](https://explorer-studio.genlayer.com/tx/0xdd53e8c0b003693cd65f0763da848af66e1670f99a5def7d0d82ce3dbf24a9cc) |
| undersized | rejected; 2 completed / 5 required | REFUNDED | [0xbe42e976a0…](https://explorer-studio.genlayer.com/tx/0xbe42e976a0e651b1b230289cf5e88ff528ba7019a8d60821cf85bf46725fa871); [0x54f9289f23…](https://explorer-studio.genlayer.com/tx/0x54f9289f23c342054eaf16216a427fba85c9dc48f3d160d28ddb037add4bb5d2) |

The event fixture locks trading close at 1791969441, observation at 1791969561 and resolution readiness at 1791969651. Its final report is explicitly published after observation and trading close. The independently verified YES ruling therefore uses valid post-close evidence rather than treating trading cutoff as an evidence deadline.

The historical URLs actually changed from the original captured bulletin to a corrected document before adjudication. The registered hashes and original snapshots remain in the record. Independently retrieved new digests differ, producing `historical_snapshot_mismatch`, UNKNOWN readings and UNRESOLVABLE. The incomplete fixture contains a favorable opening and a distant retraction in a document larger than the inspection budget. Every partial reading is rejected as conclusive regardless of the model's verdict or disagreement policy. A separate behavioral regression checks a distant qualification inside a fully inspected document.

The undersized hearing was signed by the distinct outsider account after relay grace. It requested three seats, completed only 2 unique readings and was rejected by `verify_hearing`. Before and after proof, the vault retained ruling round 0, no challenge window, and its unchanged deadline 1791971704. REST remained PENDING and a pinned consumer had no authoritative outcome. The direct early `finalize` call [0x363cdcf56d…](https://explorer-studio.genlayer.com/tx/0x363cdcf56d90498337b21ac1028b84f1d3d93f6a0e2fcde7d161ee3befb8a3a8) finalized with execution failure. The full rejected candidate and participant readings remain on the public docket and in the receipt record.

Timeout [0xe78eb692bc…](https://explorer-studio.genlayer.com/tx/0xe78eb692bc5909316295f200da70f936f5dc0bedd3924cdc08d09cca08c358d5) permissionlessly refunded its actual 7 wei payer. REFUNDED is a final non-adjudication, not an authoritative YES candidate.

## Native delivery proof

Two funded exits returned 7 + 9 = 16 wei to their economic payer. Withdrawal [0x53bb6937c1…](https://explorer-studio.genlayer.com/tx/0x53bb6937c1773b5aa66a27ba2c7dee3356fbf91ed9ee4e182d8ae3b0ad692794) emitted exactly one native SEND [0x34d7b79b68…](https://explorer-studio.genlayer.com/tx/0x34d7b79b6831f089ce5d91fc8fb06da4c8d65991107dad2e154ca3131cc42e3e). The child is FINALIZED, targets the beneficiary, names this vault and parent, carries value 16, and records actual ledger credit. The beneficiary balance increased by exactly 16 before any subsequent payable test.

Unauthorized confirmation [0x6dc08205e5…](https://explorer-studio.genlayer.com/tx/0x6dc08205e552b8ab29e9f22dcd7504739a995b01385cc4817104f00014ffc425) and incorrect relay proof [0x2170a84afa…](https://explorer-studio.genlayer.com/tx/0x2170a84afa227427d5abaf2b64735d108fe74bed50ac44dd209618a2c07b6204) finalized with execution errors. Both preserved the pending payment. Correct confirmation [0x09b4e2633b…](https://explorer-studio.genlayer.com/tx/0x09b4e2633b6d7019827edaa74d4e3913e0d5973dc6f173359905a46a72a620ef) stored delivered status and both bound transaction hashes. Duplicate restoration [0xae0a92d68b…](https://explorer-studio.genlayer.com/tx/0xae0a92d68b9098fd10b79dedc06e8c6bdabe258d7040dcb3b3bab1892f3f328a) finalized with execution failure; remaining beneficiary credit is zero and no duplicate transfer was emitted.

Actual **failed child ledger credit** is covered behaviorally by the contract's RPC-proof tests: a correctly bound finalized child with `value_credited=false` cannot be confirmed by the relay, remains recoverable, requires exact replacement backing, restores once, and cannot reuse an old withdrawal receipt for the retry. This live run does not fabricate a failed Studio SEND: its native transfer actually succeeded. The requested live payment-confirmation failures are the finalized unauthorized and incorrect-relay transactions above.

## Native appeals remain separate

The original unsuccessful native rollback remains in [native-appeal-attempt.json](../deployments/native-appeal-attempt.json). Its docket became unavailable; no successful appeal, settlement or native payment is claimed for that historical attempt.

In the new native case, the initial hearing [0xf53d6b9aff…](https://explorer-studio.genlayer.com/tx/0xf53d6b9aff7a401d892d34ee26a4c14de712339720ea4dd80c0910672f93345c) reached finality before the accepted poll could submit an appeal. A subsequent direct native submission returned the original ID, but the captured receipt has no new completed appeal-validation evidence. This is not claimed as a fresh successful or failed native appeal. Its unverified hearing never authorized the vault. Permissionless timeout [0x75246cc78c…](https://explorer-studio.genlayer.com/tx/0x75246cc78cbf9ec1c54f9c6f2ac24626a4c2c2b2f04d830627ee1f5e3f638803) actually refunded the 9 wei fee, which is included in the proven native 16 wei payment.

The stronger missing-docket case is exercised behaviorally: even when native rollback removes the entire docket, vault recovery uses only vault state; a failed closure notification cannot undo credits, hide the final refund, or leave the service operation stuck. Refund publication uses the vault's final round even when the docket is unavailable. Application bonded challenges remain separately funded rounds, and native appeals remain paused in the API/worker/UI.

## Consumers and verification

All five finalized cases were consumed through the pinned Polymarket-style adapter and signed reference endpoint. The event maps to `pay_yes`; uncertainty and timeout cases map to `refund`. Each reference receiver independently read finalized vault state, recorded one decision, accepted a duplicate without another action, and rejected a changed event ID with HTTP 401. Signed settlement attestations verified against the actual relay. These are reference decisions only: no outside venue position or funds were changed.

Validation: **126 contract tests**, **97 backend/React tests**, all three GenVM lints, ESLint, TypeScript, production build, deployed registry/vault/factory source parity, and **3 production Playwright checks**. `npm run test:review` is resumable and exits without repeating payments once its recorded deployment is verified. `npm run test:review-consumers` rechecks the final adapters and reference ledger. Never remove a broadcast marker and resend an ambiguous payable operation.

The receipt adapter is deliberately tied to the immutable official Studio RPC. Validators independently retrieve and check finalized receipts inside consensus; caller-supplied success flags and relay statements have no authority. This is an RPC oracle, **not a cryptographic inclusion proof or production state bridge**. Production use requires an authenticated proof adapter for the intended consensus and transfer layer. Historical hashes commit content, not publication time; historical mode also requires explicit dated support in complete authoritative documents.

The live Studio pool was read as 20 validators. Requests are capped to that count, so the final funded requirement of 11 requests 20 seats (whose majority is 11), instead of an unavailable 21. An insufficient available pool fails preflight without broadcasting; on-contract proof and the funded timeout remain unchanged.
