import { authenticate, checkOrigin, fail, HttpError } from "@/lib/auth";
import { listQuestions } from "@/lib/queries";
import { registerQuestion } from "@/lib/service";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const owner =
      u.searchParams.get("mine") === "true"
        ? (await authenticate(req)).id
        : undefined;
    return Response.json(
      {
        questions: await listQuestions(
          owner,
          Math.min(100, Math.max(1, Number(u.searchParams.get("limit")) || 50)),
          Math.max(0, Number(u.searchParams.get("offset")) || 0),
        ),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const owner = await authenticate(req);
    const key = req.headers.get("idempotency-key");
    if (!key || key.length > 200)
      throw new HttpError(400, "An idempotency key is required.");
    return Response.json(await registerQuestion(owner, await req.json(), key), {
      status: 202,
    });
  } catch (e) {
    return fail(e);
  }
}
