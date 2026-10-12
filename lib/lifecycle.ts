export const appealableStatuses = [
  "ACCEPTED",
  "UNDETERMINED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
] as const;
export function protocolAppealable(status: string) {
  return appealableStatuses.some((candidate) => candidate === status);
}
export function fundedRehearing(
  escrow:
    | { funded?: boolean; settled?: boolean; challenge_count?: number }
    | null
    | undefined,
  rounds: number,
) {
  return (
    !!escrow?.funded &&
    !escrow.settled &&
    Number(escrow.challenge_count) > 0 &&
    rounds < Number(escrow.challenge_count) + 1
  );
}
export function questionState(
  escrow: {
    funded?: boolean;
    settled?: boolean;
    challenge_count?: number;
    version?: number;
    opened_round?: number;
  },
  rounds: number,
  close: number,
  now: number,
) {
  if (escrow.settled) return "settled";
  if (!escrow.funded) return "awaiting_fee";
  if (fundedRehearing(escrow, rounds)) return "awaiting_rehearing";
  if (
    rounds &&
    Number(escrow.version) >= 2 &&
    Number(escrow.opened_round) < rounds
  )
    return "awaiting_window";
  if (rounds) return "resolved";
  return now >= close ? "ready" : "open";
}
