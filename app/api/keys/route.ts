import { randomBytes, randomUUID } from "node:crypto";
import { authenticate, checkOrigin, fail, HttpError } from "@/lib/auth";
import { digest } from "@/lib/security";
import { db } from "@/lib/db";
export async function GET(req: Request) {
  try {
    const owner = await authenticate(req);
    return Response.json({
      keys: await db()`SELECT id,prefix,created_at FROM api_keys WHERE owner_id=${owner.id} AND revoked_at IS NULL`,
    });
  } catch (e) {
    return fail(e);
  }
}
export async function POST(req: Request) {
  try {
    checkOrigin(req);
    const owner = await authenticate(req);
    const count =
      await db()`SELECT count(*)::int AS n FROM api_keys WHERE owner_id=${owner.id} AND revoked_at IS NULL`;
    if (count[0].n >= 5)
      throw new HttpError(
        400,
        "Revoke an existing key before creating another.",
      );
    const key = "srt_" + randomBytes(32).toString("hex");
    await db()`INSERT INTO api_keys(id,owner_id,key_hash,prefix) VALUES(${randomUUID()},${owner.id},${digest(key)},${key.slice(0, 12)})`;
    return Response.json({ key }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return fail(e);
  }
}
export async function DELETE(req: Request) {
  try {
    checkOrigin(req);
    const owner = await authenticate(req);
    const { id } = await req.json();
    await db()`UPDATE api_keys SET revoked_at=now() WHERE id=${id} AND owner_id=${owner.id}`;
    return Response.json({ revoked: true });
  } catch (e) {
    return fail(e);
  }
}
