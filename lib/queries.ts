import { db } from "./db";
import type { Question } from "./types";
export async function listQuestions(owner?: string, limit = 50, offset = 0) {
  const sql = db();
  const rows = owner
    ? await sql`SELECT id,specification,criteria_hash,docket_address,status,fee::text,base_bond::text,created_at,docket,escrow FROM questions WHERE owner_id=${owner} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    : await sql`SELECT id,specification,criteria_hash,docket_address,status,fee::text,base_bond::text,created_at,docket,escrow FROM questions WHERE docket_address IS NOT NULL ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  return rows as Question[];
}
export async function getQuestion(id: string) {
  const rows =
    await db()`SELECT id,specification,criteria_hash,docket_address,status,fee::text,base_bond::text,created_at,docket,escrow FROM questions WHERE id=${id}`;
  if (!rows[0]) return null;
  const receipts =
    await db()`SELECT tx_hash,kind,receipt FROM receipts WHERE question_id=${id} ORDER BY created_at`;
  return { ...rows[0], receipts } as Question;
}
export async function getOperations(id: string, owner: string) {
  return db()`SELECT id,kind,status,tx_hash,error,created_at FROM operations WHERE question_id=${id} AND owner_id=${owner} ORDER BY created_at DESC`;
}
