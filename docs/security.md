# Security notes

The relay key, Privy app secret, Neon connection, worker credential and encryption key belong on the server. Only the Privy app ID is public. The private local file has mode 600, is ignored by Git and is scanned against tracked source, history and browser output before release. API keys are hashed; webhook secrets use authenticated encryption.

The October 2026 audit remediation pins PostCSS 8.5.29 and ws 8.22.0 to address their reported advisories. The remaining high severity braces advisory has no published patched version. In this repository it occurs only through the development ESLint Next plugin and its fixed filesystem glob patterns. The web application accepts no user glob patterns and does not expose that code path. It is not a remote application input surface. Keep this exception under review and replace the package when the upstream fix is published.

Studio uses test GEN and supports developer execution modes. It is not the production security boundary for a market's real funds. The service requests independent normal consensus, records actual receipts and restricts new docket resolutions to its configured relay. It does not choose juror identities.

Signed webhook timestamps and event IDs bind the exact raw body. The reference consumer verifies expected criteria, question, contract and network, checks finalized vault state and records each question once. A foreign chain still requires an authenticated bridge or oracle.

Historical contract addresses are preserved for inspection and existing settlement recovery. New sponsored funding and challenges use the current immutable contracts. Never describe a historical source hash as the latest deployed code.
