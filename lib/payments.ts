import { db } from "./db";
/**
 * One reconciliation per payment at a time. A pending payment can be found by
 * a completed withdrawal, by the on chain scanner and by its beneficiary at
 * the same time; two submissions in flight would leave the loser failing
 * against the contract, because the first one already moved the payment out of
 * its pending state.
 */
export function activePaymentOperation(claimant: string, paymentId: string) {
  return db()`SELECT id,kind,status,tx_hash FROM operations WHERE kind IN ('confirm_payment','restore_payment')
    AND payload->>'claimant'=${claimant} AND payload->>'payment_id'=${paymentId}
    AND status IN ('queued','submitting','submitted','needs_review')`;
}
