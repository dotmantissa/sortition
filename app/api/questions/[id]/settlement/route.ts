import { getQuestion } from "@/lib/queries";
import { fail } from "@/lib/auth";
import { attest } from "@/lib/attestation";
import { settlementView } from "@/lib/public-settlement";
export const dynamic = "force-dynamic";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const q = await getQuestion((await params).id);
    if (!q)
      return Response.json({ error: "Question not found." }, { status: 404 });
    const view = settlementView(q);
    // An attestation is offered only when asked for, so an ordinary poll does
    // not pay for a signature.
    const wanted = new URL(req.url).searchParams.get("attest") === "true";
    return Response.json(
      {
        ...view,
        proof_url: `/dockets/${q.id}`,
        ...(wanted
          ? { attestation: await attest(view, Math.floor(Date.now() / 1000)) }
          : {}),
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
