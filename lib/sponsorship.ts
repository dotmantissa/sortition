import { db } from "./db";
import {
  maximumSponsoredPayment,
  accountDailySponsorship,
  globalDailySponsorship,
} from "./sponsor-limits";
/** Reserve before broadcasting. Serializable predicate locks prevent budget races. */
export async function reserveSponsorship(
  operation: string,
  owner: string,
  value: bigint,
) {
  if (value === 0n) return;
  if (value < 0n || value > maximumSponsoredPayment)
    throw Error("The relay sponsorship limit is too small for this payment.");
  const sql = db();
  const previous =
    await sql`SELECT owner_id,amount::text FROM sponsorships WHERE operation_id=${operation}`;
  if (previous[0]) {
    if (previous[0].owner_id !== owner || BigInt(previous[0].amount) !== value)
      throw Error("The relay sponsorship reservation needs review.");
    return;
  }
  try {
    const result = await sql.transaction(
      [
        sql`INSERT INTO sponsorships(operation_id,owner_id,amount)
        SELECT ${operation},${owner},${value.toString()}
        WHERE (SELECT COALESCE(sum(amount),0) FROM sponsorships WHERE created_at>=date_trunc('day',now()))+${value.toString()}<=${globalDailySponsorship.toString()}
        AND (SELECT COALESCE(sum(amount),0) FROM sponsorships WHERE owner_id=${owner} AND created_at>=date_trunc('day',now()))+${value.toString()}<=${accountDailySponsorship.toString()}
        ON CONFLICT(operation_id) DO NOTHING RETURNING operation_id`,
      ],
      { isolationLevel: "Serializable" },
    );
    if (!result[0].length)
      throw Error("The relay daily sponsorship budget has been reached.");
  } catch {
    throw Error(
      "The relay could not reserve this payment within its daily budget. Please try later.",
    );
  }
}
