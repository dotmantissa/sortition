import {
  networkClock,
  addresses,
  readFinal,
  object,
  type Address,
} from "./chain";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { registrationSchema, closingIsFuture } from "./validation";
import { publicDestination, encrypt, digest } from "./security";
import {
  fundedRehearing,
  timeoutClaimable,
  nativeAppealsEnabled,
  nativeAppealUnavailable,
} from "./lifecycle";
import type { Question } from "./types";
import { activePaymentOperation } from "./payments";
export const actions = [
  "resolve",
  "fund",
  "challenge",
  "finalize",
  "withdraw",
  "protocol_appeal",
  "open_round",
  "claim_timeout",
  "confirm_payment",
] as const;
/**
 * Actions the question operator alone may queue. Everything else is open to
 * any authenticated account, so an absent or unwilling operator cannot block
 * a hearing, a settlement or a refund.
 */
const operatorOnly = ["fund"];
/** Actions that do not belong to one question's exclusive queue slot. */
const unscoped = ["withdraw", "claim_timeout", "confirm_payment", "open_round"];
export async function rateLimit(owner: string) {
  const rows =
    await db()`SELECT count(*)::int AS count FROM operations WHERE owner_id=${owner} AND created_at>now()-interval '1 hour'`;
  if (rows[0].count >= 30)
    throw new HttpError(
      429,
      "You have a busy docket. Please wait before submitting another action.",
    );
}
export async function registerQuestion(
  owner: { id: string; beneficiary: string },
  body: unknown,
  key: string,
) {
  const sql = db();
  const existing =
    await sql`SELECT question_id,id,kind,payload FROM operations WHERE owner_id=${owner.id} AND idempotency_key=${key}`;
  const parsed = registrationSchema.parse(body);
  const requestHash = digest(JSON.stringify(parsed));
  if (existing[0]) {
    if (
      existing[0].kind !== "register" ||
      existing[0].payload.request_hash !== requestHash
    )
      throw new HttpError(
        409,
        "This idempotency key belongs to different question details.",
      );
    return { id: existing[0].question_id, operation_id: existing[0].id };
  }
  if (
    !closingIsFuture(
      parsed.specification.close_timestamp,
      (await networkClock()).unix * 1000,
    )
  )
    throw new HttpError(
      400,
      "Choose a closing time at least a minute after the network time.",
    );
  await rateLimit(owner.id);
  try {
    await Promise.all(
      parsed.specification.sources.map((s) => publicDestination(s.url)),
    );
    if (parsed.webhook) await publicDestination(parsed.webhook.url);
  } catch {
    throw new HttpError(
      400,
      "A source or webhook address could not be verified as a public HTTPS server.",
    );
  }
  const id = randomUUID(),
    op = randomUUID();
  const contracts = addresses();
  await sql.transaction([
    sql`INSERT INTO questions(id,owner_id,specification,beneficiary,fee,base_bond,registry_address,vault_address) VALUES(${id},${owner.id},${JSON.stringify(parsed.specification)}::jsonb,${owner.beneficiary},${parsed.fee},${parsed.base_bond},${contracts.registry},${contracts.vault})`,
    sql`INSERT INTO operations(id,question_id,owner_id,kind,idempotency_key,payload) VALUES(${op},${id},${owner.id},'register',${key},${JSON.stringify({ request_hash: requestHash })}::jsonb)`,
    ...(parsed.webhook
      ? [
          sql`INSERT INTO webhooks(question_id,url,secret_ciphertext) VALUES(${id},${parsed.webhook.url},${encrypt(parsed.webhook.secret)})`,
        ]
      : []),
  ]);
  return { id, operation_id: op };
}
/** Accounts with a stake in a settled escrow, who may queue a withdrawal. */
export function escrowParticipant(
  question: {
    owner_id?: string;
    beneficiary?: string;
    escrow?: {
      beneficiary?: string;
      fee_payer?: string;
      challenges?: { payer?: string; claimant?: string }[];
    } | null;
  },
  owner: { id: string; beneficiary: string },
) {
  if (question.owner_id === owner.id) return true;
  const mine = owner.beneficiary.toLowerCase();
  const named = [
    question.beneficiary,
    question.escrow?.beneficiary,
    question.escrow?.fee_payer,
    ...(question.escrow?.challenges || []).flatMap((c) => [
      c.payer,
      c.claimant,
    ]),
  ];
  return named.some(
    (address) => typeof address === "string" && address.toLowerCase() === mine,
  );
}
/**
 * The exact vault call a challenger can send from their own wallet, so a bond
 * can be a genuine personal stake instead of a sponsored one. The relay is not
 * involved in a self funded challenge beyond publishing these terms.
 */
export function selfFundedChallenge(question: Question) {
  const escrow = question.escrow;
  if (!escrow || !escrow.funded || escrow.settled) return null;
  const bond =
    BigInt(escrow.base_bond ?? question.base_bond) *
    2n ** BigInt(escrow.challenge_count || 0);
  return {
    contract: question.vault_address,
    function: "challenge",
    arguments: {
      question_id: question.id,
      claimant: "your own wallet address",
      expected_outcome: "YES, NO or UNRESOLVABLE, different from the ruling",
    },
    value_wei: bond.toString(),
    round_deadline: Number(escrow.round_deadline || 0),
    note: "Send this from the claimant wallet itself. Bond proceeds are credited to the account that paid them.",
  };
}
export async function queueAction(
  owner: { id: string; beneficiary: string },
  id: string,
  action: string,
  expected: string | undefined,
  key: string,
  withdrawalTx?: string,
) {
  if (!(actions as readonly string[]).includes(action))
    throw new HttpError(400, "Unknown docket action.");
  if (action === "protocol_appeal" && !nativeAppealsEnabled)
    throw new HttpError(409, nativeAppealUnavailable);
  const sql = db();
  const rows =
    await sql`SELECT owner_id,archive_reason,escrow,docket,beneficiary,vault_address FROM questions WHERE id=${id}`;
  if (!rows[0]) throw new HttpError(404, "This question was not found.");
  if (
    rows[0].archive_reason &&
    !["withdraw", "confirm_payment"].includes(action)
  )
    throw new HttpError(
      409,
      "This docket is archived after a network failure. Its public receipts are preserved.",
    );
  if (operatorOnly.includes(action) && rows[0].owner_id !== owner.id)
    throw new HttpError(403, "This action belongs to the question operator.");
  if (
    action === "challenge" &&
    !["YES", "NO", "UNRESOLVABLE"].includes(expected || "")
  )
    throw new HttpError(400, "Choose the outcome you are arguing for.");
  const duplicate =
    await sql`SELECT id,tx_hash,status,question_id,kind,payload FROM operations WHERE owner_id=${owner.id} AND idempotency_key=${key}`;
  if (duplicate[0]) {
    if (
      duplicate[0].question_id !== id ||
      duplicate[0].kind !== action ||
      (action === "challenge" && duplicate[0].payload.expected !== expected)
    )
      throw new HttpError(
        409,
        "This idempotency key belongs to a different action.",
      );
    return duplicate[0];
  }
  if (
    action === "challenge" &&
    Number(rows[0].escrow?.version) >= 2 &&
    Number(rows[0].escrow.opened_round) !==
      (rows[0].docket?.rounds?.length || 0)
  )
    throw new HttpError(
      409,
      "The finalized jury is opening its hearing window. Please try again shortly.",
    );
  if (action === "resolve" && rows[0].escrow?.settled)
    throw new HttpError(409, "This settlement is already final.");
  if (
    action === "resolve" &&
    rows[0].owner_id !== owner.id &&
    !fundedRehearing(rows[0].escrow, rows[0].docket?.rounds?.length || 0) &&
    (rows[0].docket?.rounds?.length || 0) > 0
  )
    throw new HttpError(
      409,
      "This hearing is complete. Fund a challenge to open another round.",
    );
  if (
    action === "claim_timeout" &&
    !timeoutClaimable(rows[0].escrow, (await networkClock()).unix)
  )
    throw new HttpError(
      409,
      "This funded hearing is not past its deadline, or it already has a ruling to finalize.",
    );
  if (["withdraw", "confirm_payment"].includes(action)) {
    // A withdrawal belongs to the caller's own beneficiary. Requiring real
    // withdrawable credit stops an unrelated account queueing work against
    // someone else's docket, and stops a pointless pending payment.
    if (!escrowParticipant(rows[0], owner))
      throw new HttpError(
        403,
        "Only an account with a stake in this docket can withdraw from it.",
      );
    const vault = rows[0].vault_address as Address;
    if (action === "withdraw") {
      let credit = 0n;
      try {
        credit = BigInt(
          String(await readFinal(vault, "get_credit", [owner.beneficiary])),
        );
      } catch {
        throw new HttpError(
          503,
          "The vault credit could not be read just now. Please try again shortly.",
        );
      }
      if (credit <= 0n)
        throw new HttpError(409, "This account has no credit to withdraw.");
    }
    if (action === "confirm_payment") {
      if (
        withdrawalTx !== undefined &&
        !/^0x[0-9a-fA-F]{64}$/.test(withdrawalTx)
      )
        throw new HttpError(
          400,
          "A valid finalized withdrawal transaction hash is required.",
        );
      const payment = object(
        await readFinal(vault, "get_payment", [owner.beneficiary]),
      );
      if (payment.status !== "pending")
        throw new HttpError(
          409,
          "This account has no pending payment to confirm.",
        );
      // The same payment may already be queued by a completed withdrawal or by
      // the on chain scanner. Reconcile it once and return that operation.
      const active = await activePaymentOperation(
        owner.beneficiary,
        String(payment.id),
        vault,
      );
      if (active[0]) return active[0];
      await rateLimit(owner.id);
      const op = randomUUID();
      await sql`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key) VALUES(${op},${id},${owner.id},'confirm_payment',${JSON.stringify({ claimant: owner.beneficiary, payment_id: payment.id, withdrawal_tx: withdrawalTx })}::jsonb,${key})`;
      return { id: op, status: "queued" };
    }
  }
  await rateLimit(owner.id);
  if (
    ["fund", "challenge"].includes(action) &&
    rows[0].vault_address.toLowerCase() !== addresses().vault.toLowerCase()
  )
    throw new HttpError(
      409,
      "This resolver is archived. Register a question with the current contracts before funding a new action.",
    );
  const op = randomUUID();
  try {
    await sql`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key) VALUES(${op},${id},${owner.id},${action},${JSON.stringify({ expected, claimant: owner.beneficiary })}::jsonb,${key})`;
  } catch {
    throw new HttpError(
      409,
      unscoped.includes(action)
        ? "This account already has that action in progress."
        : "This docket already has an action in progress.",
    );
  }
  return { id: op, status: "queued" };
}
