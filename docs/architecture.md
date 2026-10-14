# How a question moves through Sortition

QuestionRegistry locks the complete canonical specification and its SHA-256 hash, deploys an immutable SortitionDocket, and binds it to SettlementVault through finalized authenticated messages. The registry, docket and vault separate registration, evidence adjudication and native GEN custody. Frontend and API previews never choose authoritative outcomes.

## Three locked clocks

`close_timestamp` is the trading cutoff. `observation_timestamp` names the event/state being judged. `resolution_timestamp` is the earliest hearing time, allowing final reports to become available. They must be ordered. Omitted observation/resolution fields explicitly inherit close during registration and are included in the canonical hash. Escrow deadlines and the relay grace period start from resolution readiness, rather than trading close.

For example, trading may stop before football kickoff, the observation time may be the end of the match, and resolution may begin after final results are published. In `event_outcome` mode, later publication can establish the specified event's final outcome. Publication time, event time and retrieval time are distinct. Both model stages receive the locked clocks and criteria.

`historical_state` additionally requires a locked `content_sha256` for every source. A changed snapshot is UNKNOWN and forces UNRESOLVABLE. Matching bytes alone still do not establish earlier authority: the complete-document audit must find explicit dated provenance supporting the observation time. Retrieval timestamps and a first-hearing fingerprint are never historical provenance. Operators must choose authoritative, dated versioned sources; a hash commitment is not a timestamp certificate.

## Independent evidence

Each participant retrieves every registered HTTPS source, extracts a canonical factual value and position, and supplies a quotation located in its own document. A second audit checks support, temporal provenance and the global uncertainty definition against complete documents, including distant qualifications and corrections. Documents above the inspection budget retain their digest and incomplete-document reason, but cannot support a conclusive verdict under any disagreement policy. Rendered fallback cannot override an incomplete-document or historical-snapshot guard.

Unanimity requires all sources to agree; majority uses the full registered denominator; tie-break requires clear positions before the named source decides. Global uncertainty overrides every policy. Temporal/provenance gaps and partial documents force UNRESOLVABLE. Malformed extraction/audit results fail execution. Temporary retrieval faults are retried and then fail the hearing; they never become a conclusive absence finding. A repeatable 4xx response is recorded as an absent source.

The custom validator repeats retrieval, extraction and audit. It compares all decisive fields, including temporal support and completeness, and verifies the leader's quote against independently fetched content. Later rounds receive first-hearing digests and readings to expose source changes; that baseline is an observation, not proof of earlier content.

## Jury authority

`resolve()` stores a **candidate only**. It cannot publish a ruling, open a challenge window, consume a funded round or settle escrow. This applies equally to the relay and direct callers after relay grace.

Anyone can call `verify_hearing(candidate_id, tx_hash)`. Inside consensus, participants independently retrieve the finalized receipt from the immutable Studio RPC. The receipt must target this docket and contain the exact candidate/round/criteria marker emitted by its executing leader. The audit counts unique completed members of the current panel, excluding old rotation leaders, idle/failed readings and duplicate identities. It requires the funded count, independent validators and an agreeing majority. A missing, unfinalized, mismatched or malformed proof changes nothing. An undersized finalized panel records `jury_status=rejected` and leaves the funded round and timeout intact; a new hearing can retry without another fee or bond.

Only a verified candidate enters `rounds` and sends an authenticated finalized callback to the vault. The vault checks the proof hash, committed count and independence before opening a fresh application challenge window. Republishing a verified ruling is idempotent. The worker requests extra seats (`2 * required - 1`, capped by the live validator pool) because Studio may stop at quorum; the committed requirement remains 5, 7, 9, 11 completed unique members.

The receipt observation is an oracle backed by the fixed Studio RPC and independently checked by GenLayer participants. It is **not cryptographic inclusion proof**. The pinned deployment is Studio-specific; production requires an authenticated consensus-state proof adapter on the intended network. An operator signature is likewise publisher authentication, not a bridge.

Public settlement stays PENDING unless escrow is final and all hearing checks are verified. Widgets, REST/Polymarket consumers and the signed reference receiver reject absent or false jury verification. A timeout REFUNDED outcome is a final non-adjudication and needs no jury.

## Custody and recovery

Fees and challenges send exact native value. Bonds double with each challenge and have a bounded round limit. Bond returns and rewards belong to the economic payer, including sponsored principal. Forfeitures and rounding dust go to the burn treasury. Sponsorship has payment and daily limits; sponsored bonds do not imply personal economic deterrence.

`withdraw()` clears credit into a durable pending payment, emits one native transfer, and prints an exact payment marker. Confirmation requires beneficiary/relay authorization **and** `withdrawal_tx`: validators independently fetch the finalized parent and its single finalized child, checking vault, beneficiary, payment ID, amount, transfer type and parent-child link. Actual Studio ledger credit must be true. An incorrect relay confirmation cannot clear pending status. Beneficiary assertions cannot bypass proof either.

`restore_withdrawal()` requires proof that the bound finalized child was not credited and exact replacement backing. Any account may supply that backing. Delivered transfers cannot be restored, unresolved transfers cannot be retried, IDs cannot be replayed, and a restored payment can create only one new withdrawal. No recovery manufactures unbacked credit or duplicates a successful payment. The worker discovers direct withdrawals by their receipt marker and reconciles each payment once.

Every funded round retains a permissionless vault timeout until a verified ruling arrives. If evidence or proof never succeeds, or a native appeal destroys the docket, `claim_timeout()` refunds every payer using vault state alone; no foreign reads or relay are required. A late callback after refund cannot reopen escrow. Native protocol appeals and application bonded challenges remain separate. The documented failed Studio appeal remains public; API/worker native appeals remain paused.

Durable Neon operations, recorded transaction hashes, serialized nonce submission, leases, due-time polling and an atomic settlement outbox survive crashes. Ambiguous submissions require reconciliation rather than blind payable retries. Finalized message repairs never charge another fee. Indexed responses expose their observation age. The reference consumer persists one action per question; it does not control external venue positions or transfer another chain's funds.
