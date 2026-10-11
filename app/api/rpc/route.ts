import { authenticate, fail, checkOrigin, HttpError } from "@/lib/auth";
import { getQuestion } from "@/lib/queries";
import { registerQuestion, queueAction } from "@/lib/service";
export async function POST(req: Request) {
  let id = null;
  try {
    checkOrigin(req);
    const b = await req.json();
    id = b.id ?? null;
    if (b.jsonrpc !== "2.0") throw new HttpError(400, "Expected JSON RPC 2.0.");
    let result;
    switch (b.method) {
      case "sortition_getDocket":
        result = await getQuestion(b.params?.question_id);
        break;
      case "sortition_registerQuestion":
        result = await registerQuestion(
          await authenticate(req),
          b.params,
          req.headers.get("idempotency-key") || String(b.id),
        );
        break;
      case "sortition_resolve":
      case "sortition_challenge":
      case "sortition_finalize":
        result = await queueAction(
          await authenticate(req),
          b.params.question_id,
          b.method.replace("sortition_", ""),
          b.params.expected_outcome,
          req.headers.get("idempotency-key") || String(b.id),
        );
        break;
      default:
        return Response.json({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: "Method not found" },
        });
    }
    return Response.json({ jsonrpc: "2.0", id, result });
  } catch (e) {
    const r = fail(e);
    return Response.json(
      {
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: (await r.json()).error },
      },
      { status: r.status },
    );
  }
}
