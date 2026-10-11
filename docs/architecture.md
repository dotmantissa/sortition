# How a question moves through Sortition

The operator writes the question, criteria and uncertainty rule, chooses two to five sources, and names a tie source from that same set. Privy verifies the email account. The server verifies that the source hosts are public and submits the complete specification to the registry.

The registry canonicalizes and hashes the specification. Its immutable docket code creates a separate contract for the question. A finalized internal message binds that address to the vault. The database waits for the child contracts to exist before marking registration complete.

The vault accepts the exact resolution fee. Zero is a valid Studio fee. The relayer sponsors native value for fees and bonds from its actual balance. The website never asks the user to sign a wallet transaction. Operator identity and payout ownership are verified from Privy rather than supplied in the request body.

After the registered closing time, the docket reads the vault and then independently fetches every source in each validator execution. Each source independently produces a canonical extracted value, a position, a content digest and a supporting quotation. The model selects a source line number; the contract saves that actual line rather than asking the model to reproduce a quotation. Cross source agreement is applied afterwards. The quotation must occur in the fetched document. A custom validator reruns the entire extraction and compares the outcome, extracted values, positions and reachability of every source exactly. Document digests and quotations are public evidence but are allowed to differ across reads because live pages can change.

Unanimity requires every registered source to be reachable and agree. Majority requires more than half of the entire registered source set, including unavailable sources in the denominator. The tie source rule requires every source to have a clear position; the named source then decides a disagreement. Missing or ambiguous evidence produces UNRESOLVABLE when the locked rule cannot be satisfied. A malformed model response rejects execution and triggers consensus retry rather than masquerading as an evidence verdict.

A funded challenge opens the next docket round. Bonds double with each round. The durable worker queues a new resolution transaction after the bond finalizes and requests panels of 5, 7, 9 and successively more validators. GenLayer chooses their identities. Each new transaction is a fresh random draw; a native protocol appeal additionally rotates the committee under the protocol rules. The application never promises that a fresh draw excludes every participant from a different transaction. Native appeals are available while the consensus decision is accepted and appealable.

Studio dockets use a fifteen minute challenge window, leaving time after protocol finality for a bonded hearing. A production deployment should choose a longer window appropriate for its source cadence and network finality.

Final settlement requires an expired docket appeal window and a completed reading for every funded challenge. Winning claimants recover their bonds and share losing bonds in proportion to winning bonded stake. If no claimant backed the final result, the question beneficiary receives the bond pool. Integer division dust also goes to that beneficiary. The resolution fee goes to the treasury. Credits can be withdrawn only to their named beneficiary. No administrator can choose a verdict or redirect a beneficiary's credit.

The public API indexes finalized contract state. Provisional verdicts are displayed as provisional. A settlement consumer receives PENDING until the vault finalizes. A foreign chain cannot authenticate this HTTP response by itself. A production consumer must verify GenLayer state through its own bridge or oracle before moving funds.

The worker serializes submissions behind a database lease. Idempotency keys prevent duplicate HTTP writes. A crash during submission without a recorded hash is marked for review; it is never blindly retried. Factory messages are asynchronous, so successful parent finalization alone does not complete registration. Jobs and webhook events persist in Neon across restarts.

Studio is a development network. Its clock can differ from the web server clock, so closing and dispute checks use the network timestamp. Contract code is pinned to a concrete GenVM runner. The deployed registry holds that code permanently; changing it requires a new registry.
