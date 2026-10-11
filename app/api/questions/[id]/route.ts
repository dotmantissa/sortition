import { authenticate, fail } from "@/lib/auth";
import { getQuestion, getOperations } from "@/lib/queries";
import { db } from "@/lib/db";
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
    if (req.headers.has("authorization")) {
      const owner = await authenticate(req);
      const rows = await db()`SELECT owner_id FROM questions WHERE id=${id}`;
      question.can_operate = rows[0]?.owner_id === owner.id;
      question.operations = (await getOperations(
        id,
        owner.id,
      )) as typeof question.operations;
    }
    return Response.json(question, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return fail(e);
  }
}
