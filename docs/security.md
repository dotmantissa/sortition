# Security notes

The relay key, Privy app secret, Neon connection, worker credential and encryption key belong on the server. Only the Privy app ID is public. The private local file has mode 600, is ignored by Git and is scanned against tracked source, history and browser output before release. API keys are hashed; webhook secrets use authenticated encryption.

The October 2026 audit remediation pins PostCSS 8.5.29 and ws 8.22.0 to address their reported advisories. The remaining high severity braces advisory has no published patched version. In this repository it occurs only through the development ESLint Next plugin and its fixed filesystem glob patterns. The web application accepts no user glob patterns and does not expose that code path. It is not a remote application input surface. Keep this exception under review and replace the package when the upstream fix is published.

Studio uses test GEN and supports developer execution modes. It is not the production security boundary for a market's real funds. The service requests the panel the contract committed to for each round, records actual receipts, and publishes a comparison of each receipt with that commitment. GenLayer does not expose the seated panel to contract code, so that comparison, not in-VM enforcement, is where a panel requirement becomes checkable. A hearing with no independent validator is published as an unverified panel. The service does not choose juror identities.

The relay is not a trust anchor for verdicts and no longer a liveness anchor either. It keeps only a grace period in which to request a hearing; afterwards any account can. Settlement, ruling republication, payment confirmation, backed payment restoration and the funded hearing release are all permissionless or available to the affected beneficiary. The registry can rotate a docket's relay and both contracts can hand over the relay role, so a compromised or lost key can be retired without touching any locked specification, stored ruling or escrow.

Signed webhook timestamps and event IDs bind the exact raw body. The reference consumer verifies expected criteria, question, contract and network, checks finalized vault state and records each question once. A foreign chain still requires an authenticated bridge or oracle.

Historical contract addresses are preserved for inspection and existing settlement recovery. New sponsored funding and challenges use the current immutable contracts. Never describe a historical source hash as the latest deployed code.

The live native appeal test is retained in [its public receipt](../deployments/native-appeal-attempt.json). The initial jury accepted matching independent readings. Appeal validators then read the applied docket state, and recomputation returned `invalid_contract absent_runner_comment`. The final source lookup reported that docket as not deployed, while registry and vault hashes remained unchanged. This is observed Studio behavior, not a demonstrated production network defect. [Studio limitations](https://docs.genlayer.com/developers/intelligent-contracts/tools/genlayer-studio/limitations) describe why production behavior needs validation on the intended network.

Pausing appeals in the API, worker and UI only stops this application from submitting them. Appealing a transaction is a protocol operation, so nothing here can establish that a direct protocol appeal is impossible, and the documentation does not claim it. The contracts are instead written to be indifferent to one:

- A round that already has a recorded ruling cannot be overwritten. A re-executed hearing proposing a different outcome for that round is rejected, and a repeated identical ruling is accepted idempotently, so an appeal cannot rewrite a settled escrow.
- A docket left unable to complete its hearing still has a deadline. Once it passes, anyone can release the docket and every payer is refunded, so an appeal that bricks a hearing can no longer strand funds.
- A ruling that lands after a refund is accepted quietly and changes nothing.

Bonded application hearings use separate transactions and remain available.

## What signatures do and do not prove

The settlement attestation is an operator signature over an exact statement of
an indexed settlement. It proves which key published that record. It does not
prove GenLayer consensus, it is not a bridge, and a verifier that treats it as
one is trusting this operator completely. A consumer moving real value must
verify GenLayer state through its own bridge, light client or oracle set.

Webhook signatures bind the raw body and the event ID with a shared secret, and
the reference consumer additionally reads finalized vault state and refuses a
settlement whose hearings did not seat their committed panel. That is still a
single publisher's word about another chain's state.
