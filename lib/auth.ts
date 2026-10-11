import { PrivyClient } from "@privy-io/server-auth";
import { db } from "./db";
import { env } from "./env";
import { digest } from "./security";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function authenticate(req: Request) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer "))
    throw new HttpError(401, "Sign in with your email to continue.");
  const token = auth.slice(7);
  if (token.startsWith("srt_")) {
    const rows =
      await db()`SELECT o.* FROM api_keys k JOIN operators o ON o.id=k.owner_id WHERE k.key_hash=${digest(token)} AND k.revoked_at IS NULL`;
    if (!rows[0]) throw new HttpError(401, "This API key is no longer valid.");
    return rows[0] as { id: string; beneficiary: string };
  }
  const privy = new PrivyClient(
    env("NEXT_PUBLIC_PRIVY_APP_ID"),
    env("PRIVY_APP_SECRET"),
  );
  let user;
  try {
    const claims = await privy.verifyAuthToken(token);
    user = await privy.getUserById(claims.userId);
  } catch {
    throw new HttpError(401, "Your session has expired. Please sign in again.");
  }
  if (!user.email?.address)
    throw new HttpError(403, "Sortition uses email accounts.");
  const wallet = user.linkedAccounts.find(
    (a) =>
      a.type === "wallet" &&
      a.walletClientType === "privy" &&
      a.chainType === "ethereum",
  );
  if (!wallet || wallet.type !== "wallet")
    throw new HttpError(
      409,
      "Your account is still getting ready. Please try again shortly.",
    );
  await db()`INSERT INTO operators(id,beneficiary) VALUES(${user.id},${wallet.address}) ON CONFLICT(id) DO UPDATE SET beneficiary=EXCLUDED.beneficiary`;
  return { id: user.id, beneficiary: wallet.address };
}
export function fail(error: unknown) {
  if (error instanceof HttpError)
    return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof Error && error.name === "ZodError")
    return Response.json(
      {
        error: "Some details need another look.",
        details: JSON.parse(error.message),
      },
      { status: 400 },
    );
  return Response.json(
    { error: "We could not complete that request. Please try again shortly." },
    { status: 503 },
  );
}
export function checkOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin)
    throw new HttpError(403, "This request must come from Sortition.");
}
