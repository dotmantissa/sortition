export type Outcome = "YES" | "NO" | "UNRESOLVABLE";
export type FinalOutcome = Outcome | "REFUNDED";
export type Source = { name: string; url: string; content_sha256?: string };
export type Specification = {
  question: string;
  criteria: string;
  sources: Source[];
  tie_break_url: string;
  disagreement_rule: "unanimous" | "majority" | "tie_break";
  close_timestamp: number;
  observation_timestamp?: number;
  resolution_timestamp?: number;
  evidence_mode?: "event_outcome" | "historical_state";
  unresolvable_definition: string;
  venue?: {
    name: string;
    market_id: string;
    url: string;
    open_interest_usd?: number;
  };
};
export type Evidence = Source & {
  reachable: boolean;
  value: string;
  position: string;
  digest: string;
  /** The document window around the located quotation. */
  excerpt: string;
  /** The verbatim passage the reading was extracted from. */
  quote?: string;
  quote_offset?: number;
  status?: number;
  retrieval?: string;
  document_characters?: number;
  document_is_partial?: boolean;
  /** The document differs from the first hearing's record of this source. */
  source_changed?: boolean;
};
export type Round = {
  outcome: Outcome;
  round: number;
  resolved_at: number;
  deadline: number;
  sources: Evidence[];
  uncertainty_applies?: boolean;
  /** The panel this round was funded for, committed by the contract. */
  required_validators?: number;
  closing_timestamp?: number;
  jury_status?: "pending" | "verified" | "rejected";
  tx_hash?: string;
  panel_check?: PanelCheck;
  candidate_id?: string;
  observation_timestamp?: number;
  resolution_timestamp?: number;
  evidence_mode?: string;
};
export type PanelCheck = {
  round: number;
  tx_hash: string | null;
  required: number;
  observed: number;
  independent_validators: number;
  leader_only: boolean;
  verified: boolean;
};
export type Question = {
  registry_address?: string;
  vault_address?: string;
  can_operate?: boolean;
  archived?: boolean;
  archive_reason?: string | null;
  credit?: string;
  payment?: { id?: string; amount?: string; status?: string } | null;
  id: string;
  specification: Specification;
  criteria_hash: string | null;
  docket_address: string | null;
  status: string;
  fee: string;
  base_bond: string;
  created_at: string;
  indexed_at?: string;
  index_age_seconds?: number | null;
  stale?: boolean;
  panel_checks?: PanelCheck[];
  timeout_claimable?: boolean;
  self_funded_challenge?: {
    contract?: string;
    function: string;
    arguments: Record<string, string>;
    value_wei: string;
    round_deadline: number;
    note: string;
  } | null;
  docket?: {
    version?: number;
    unavailable?: boolean;
    candidates?: Round[];
    rounds: Round[];
    required_validators?: number;
    open_to_anyone_after?: number;
    relay?: string;
  };
  escrow?: {
    version?: number;
    opened_round?: number;
    round_deadline?: number;
    hearing_deadline?: number;
    required_validators?: number;
    base_bond?: string;
    fee_payer?: string;
    beneficiary?: string;
    refunded?: boolean;
    funded: boolean;
    settled: boolean;
    challenge_count: number;
    outcome: string;
    challenges: {
      payer?: string;
      claimant: string;
      expected: Outcome;
      bond: string;
      round: number;
    }[];
  };
  operations?: Operation[];
  receipts?: {
    tx_hash: string;
    kind: string;
    receipt: Record<string, unknown>;
  }[];
};
export type Operation = {
  id: string;
  kind: string;
  status: string;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
};
