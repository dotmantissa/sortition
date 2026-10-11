import { getQuestion } from "@/lib/queries";
import { fail } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const q = await getQuestion((await params).id);
    if (!q)
      return Response.json({ error: "Question not found." }, { status: 404 });
    return Response.json(
      {
        question_id: q.id,
        outcome: q.escrow?.settled ? q.escrow.outcome : "PENDING",
        final: q.escrow?.settled === true,
        criteria_hash: q.criteria_hash,
        docket_address: q.docket_address,
        network: "studionet",
        rounds: q.docket?.rounds.length || 0,
        proof_url: `/dockets/${q.id}`,
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
      },
    );
  } catch (e) {
    return fail(e);
  }
}
