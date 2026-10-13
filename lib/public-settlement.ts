import type { Question, PanelCheck } from "./types";
import type { Settlement } from "./settlement";

/** How long an indexed record may be before a consumer should treat it as lagging. */
export const stalenessSeconds = 300;

export function indexAge(question: Question, now = Date.now()) {
  const indexed = question.indexed_at
    ? Date.parse(question.indexed_at)
    : Date.parse(question.created_at);
  return Number.isFinite(indexed)
    ? Math.max(0, Math.round((now - indexed) / 1000))
    : null;
}
/**
 * Every published hearing round must have seated at least the panel its round
 * was funded for, with at least one independent validator. A hearing recorded
 * under leader only execution is reported as unverified rather than silently
 * presented as consensus.
 */
export function panelVerified(
  checks: PanelCheck[] | undefined,
  rounds: number,
) {
  if (!rounds) return null;
  if (!checks?.length) return false;
  const byRound = new Map(checks.map((c) => [Number(c.round), c]));
  for (let round = 1; round <= rounds; round++) {
    const check = byRound.get(round);
    if (!check || !check.verified) return false;
  }
  return true;
}
/**
 * The public settlement record. It is the database's indexed view of
 * finalized contract state, so it always says how old that view is.
 */
export function settlementView(
  question: Question,
  now = Date.now(),
): Omit<Settlement, "panel_verified"> & {
  refunded: boolean;
  as_of: string | null;
  index_age_seconds: number | null;
  stale: boolean;
  panel_verified: boolean | null;
  panel_checks: PanelCheck[];
} {
  const rounds = question.docket?.rounds.length || 0;
  const settled = question.escrow?.settled === true;
  const refunded = question.escrow?.refunded === true;
  const age = indexAge(question, now);
  // A final settlement cannot change, so its indexed view is never out of
  // date however long ago it was written. Only a pending record can lag.
  const stale = !settled && (age === null || age > stalenessSeconds);
  return {
    question_id: question.id,
    outcome: settled
      ? ((refunded
          ? "REFUNDED"
          : question.escrow?.outcome) as Settlement["outcome"])
      : "PENDING",
    final: settled,
    refunded: settled && refunded,
    criteria_hash: question.criteria_hash,
    docket_address: question.docket_address,
    network: "studionet",
    rounds,
    as_of: question.indexed_at ?? null,
    index_age_seconds: age,
    stale,
    panel_verified: panelVerified(question.panel_checks, rounds),
    panel_checks: question.panel_checks ?? [],
  };
}
