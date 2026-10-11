import { networkClock, addresses } from "./chain";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { registrationSchema, closingIsFuture } from "./validation";
import { publicDestination, encrypt } from "./security";
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
    await sql`SELECT question_id,id FROM operations WHERE owner_id=${owner.id} AND idempotency_key=${key}`;
  if (existing[0])
    return { id: existing[0].question_id, operation_id: existing[0].id };
  const parsed = registrationSchema.parse(body);
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
    sql`INSERT INTO operations(id,question_id,owner_id,kind,idempotency_key) VALUES(${op},${id},${owner.id},'register',${key})`,
    ...(parsed.webhook
      ? [
          sql`INSERT INTO webhooks(question_id,url,secret_ciphertext) VALUES(${id},${parsed.webhook.url},${encrypt(parsed.webhook.secret)})`,
        ]
      : []),
  ]);
  return { id, operation_id: op };
}
export async function queueAction(
  owner: { id: string; beneficiary: string },
  id: string,
  action: string,
  expected: string | undefined,
  key: string,
) {
  if (
    ![
      "resolve",
      "fund",
      "challenge",
      "finalize",
      "withdraw",
      "protocol_appeal",
    ].includes(action)
  )
    throw new HttpError(400, "Unknown docket action.");
  const sql = db();
  const rows = await sql`SELECT owner_id FROM questions WHERE id=${id}`;
  if (!rows[0]) throw new HttpError(404, "This question was not found.");
  if (
    action !== "challenge" &&
    action !== "withdraw" &&
    action !== "protocol_appeal" &&
    rows[0].owner_id !== owner.id
  )
    throw new HttpError(403, "This action belongs to the question operator.");
  if (
    action === "challenge" &&
    !["YES", "NO", "UNRESOLVABLE"].includes(expected || "")
  )
    throw new HttpError(400, "Choose the outcome you are arguing for.");
  await rateLimit(owner.id);
  const duplicate =
    await sql`SELECT id,tx_hash,status,question_id,kind FROM operations WHERE owner_id=${owner.id} AND idempotency_key=${key}`;
  if (duplicate[0]) {
    if (duplicate[0].question_id !== id || duplicate[0].kind !== action)
      throw new HttpError(
        409,
        "This idempotency key belongs to a different action.",
      );
    return duplicate[0];
  }
  const op = randomUUID();
  try {
    await sql`INSERT INTO operations(id,question_id,owner_id,kind,payload,idempotency_key) VALUES(${op},${id},${owner.id},${action},${JSON.stringify({ expected, claimant: owner.beneficiary })}::jsonb,${key})`;
  } catch {
    throw new HttpError(409, "This docket already has an action in progress.");
  }
  return { id: op, status: "queued" };
}
