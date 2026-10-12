import { authenticate, fail } from "@/lib/auth";
import { getQuestion, getOperations } from "@/lib/queries";
import { db } from "@/lib/db";
import { readFinal, object, networkClock, type Address } from "@/lib/chain";
import { timeoutClaimable } from "@/lib/lifecycle";
import { selfFundedChallenge } from "@/lib/service";
import { indexAge, stalenessSeconds } from "@/lib/public-settlement";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const question = await getQuestion(id);
    if (!question)
      return Response.json({ error: "Question not found." }, { status: 404 });
    const age = indexAge(question);
    question.index_age_seconds = age;
    question.stale = age === null || age > stalenessSeconds;
    question.timeout_claimable = timeoutClaimable(
      question.escrow,
      (await networkClock()).unix,
    );
    question.self_funded_challenge = selfFundedChallenge(question);
    if (req.headers.has("authorization")) {
      const owner = await authenticate(req);
      const rows = await db()`SELECT owner_id FROM questions WHERE id=${id}`;
      question.can_operate =
        !question.archive_reason && rows[0]?.owner_id === owner.id;
      if (question.escrow?.settled) {
        question.credit = String(
          await readFinal(question.vault_address as Address, "get_credit", [
            owner.beneficiary,
          ]),
        );
        // A pending payment blocks the next withdrawal, so the beneficiary is
        // shown it and can confirm their own delivery.
        question.payment = object(
          await readFinal(question.vault_address as Address, "get_payment", [
            owner.beneficiary,
          ]),
        ) as typeof question.payment;
      }
      question.operations = (await getOperations(
        id,
      )) as typeof question.operations;
    }
    return Response.json(question, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
