export type Outcome = "YES" | "NO" | "UNRESOLVABLE";
export type Source = { name: string; url: string };
export type Specification = {
  question: string;
  criteria: string;
  sources: Source[];
  tie_break_url: string;
  disagreement_rule: "unanimous" | "majority" | "tie_break";
  close_timestamp: number;
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
  excerpt: string;
};
export type Round = {
  outcome: Outcome;
  round: number;
  resolved_at: number;
  deadline: number;
  sources: Evidence[];
};
export type Question = {
  registry_address?: string;
  vault_address?: string;
  can_operate?: boolean;
  archived?: boolean;
  archive_reason?: string | null;
  credit?: string;
  id: string;
  specification: Specification;
  criteria_hash: string | null;
  docket_address: string | null;
  status: string;
  fee: string;
  base_bond: string;
  created_at: string;
  docket?: { rounds: Round[] };
  escrow?: {
    version?: number;
    opened_round?: number;
    round_deadline?: number;
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
