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
    const write = b.method !== "sortition_getDocket";
    const key =
      req.headers.get("idempotency-key") ||
      (typeof b.id === "string" ||
      (typeof b.id === "number" && Number.isSafeInteger(b.id))
        ? String(b.id)
        : "");
    if (write && (!key || key.length > 200))
      throw new HttpError(
        400,
        "A unique request ID or idempotency key is required for a write.",
      );
    let result;
    switch (b.method) {
      case "sortition_getDocket":
        result = await getQuestion(b.params?.question_id);
        break;
      case "sortition_registerQuestion":
        result = await registerQuestion(await authenticate(req), b.params, key);
        break;
      case "sortition_resolve":
      case "sortition_challenge":
      case "sortition_finalize":
        result = await queueAction(
          await authenticate(req),
          b.params.question_id,
          b.method.replace("sortition_", ""),
          b.params.expected_outcome,
          key,
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
