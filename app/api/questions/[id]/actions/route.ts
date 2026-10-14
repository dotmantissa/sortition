import { authenticate, checkOrigin, fail, HttpError } from "@/lib/auth";
import { queueAction } from "@/lib/service";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    checkOrigin(req);
    const owner = await authenticate(req);
    const { id } = await params;
    const body = await req.json();
    const key = req.headers.get("idempotency-key");
    if (!key || key.length > 200)
      throw new HttpError(400, "An idempotency key is required.");
    return Response.json(
      await queueAction(
        owner,
        id,
        body.action,
        body.expected_outcome,
        key,
        body.withdrawal_tx,
      ),
      { status: 202 },
    );
  } catch (e) {
    return fail(e);
  }
}
