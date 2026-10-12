// Studio appeal rollback failed in the recorded live verification, so the
// application never sponsors that path. It is a protocol operation and cannot
// be switched off, so the contracts are written to tolerate a re-executed or
// rolled back hearing instead of relying on this flag. See docs/security.md.
export const nativeAppealsEnabled: boolean = false;
export const nativeAppealUnavailable =
  "Native protocol appeals are paused on this Studio deployment after a failed rollback. Use a bonded docket hearing.";
export const appealableStatuses = [
  "ACCEPTED",
  "UNDETERMINED",
  "LEADER_TIMEOUT",
  "VALIDATORS_TIMEOUT",
] as const;
/** The deployed registry's bonded round limit; panels grow 5, 7, 9, 11. */
export const maxBondedRounds = 3;
export function protocolAppealable(status: string) {
  return appealableStatuses.some((candidate) => candidate === status);
}
type Escrow = {
  funded?: boolean;
  settled?: boolean;
  refunded?: boolean;
  challenge_count?: number;
  version?: number;
  opened_round?: number;
  ruling_round?: number;
  hearing_deadline?: number;
  outcome?: string;
} | null | undefined;
export function fundedRehearing(escrow: Escrow, rounds: number) {
  return (
    !!escrow?.funded &&
    !escrow.settled &&
    Number(escrow.challenge_count) > 0 &&
    rounds < Number(escrow.challenge_count) + 1
  );
}
/**
 * A funded hearing that passed its deadline without producing the ruling for
 * the current round can be released by anyone, refunding every payer. This is
 * the bounded exit for a hearing that consensus never completes.
 */
export function timeoutClaimable(escrow: Escrow, now: number) {
  const deadline = Number(escrow?.hearing_deadline || 0);
  return (
    !!escrow?.funded &&
    !escrow.settled &&
    Number(escrow.version) >= 4 &&
    deadline > 0 &&
    now >= deadline &&
    Number(escrow.ruling_round) !== Number(escrow.challenge_count) + 1
  );
}
export function questionState(
  escrow: NonNullable<Escrow>,
  rounds: number,
  close: number,
  now: number,
) {
  if (escrow.refunded) return "refunded";
  if (escrow.settled) return "settled";
  if (!escrow.funded) return "awaiting_fee";
  if (timeoutClaimable(escrow, now)) return "awaiting_refund";
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
