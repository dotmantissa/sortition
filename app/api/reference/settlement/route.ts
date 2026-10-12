import { db } from "@/lib/db";
import { decrypt, digest } from "@/lib/security";
import { readFinal, object, type Address } from "@/lib/chain";
import { parseSettlement } from "@/lib/settlement";
import { panelVerified } from "@/lib/public-settlement";
import { verifySortitionWebhook } from "@/integrations/verify-webhook";
/** A reference consumer ledger. It cannot pay or modify positions at a venue. */
export async function POST(req: Request) {
  try {
    const body = await req.text();
    if (body.length > 8192)
      return Response.json({ error: "Invalid event" }, { status: 400 });
    const event = JSON.parse(body);
    if (
      event.type !== "question.settled" ||
      typeof event.question_id !== "string" ||
      event.question_id.length > 80
    )
      return Response.json({ error: "Invalid event" }, { status: 400 });
    const sql = db();
    const receivers =
      await sql`SELECT r.*,q.vault_address,q.panel_checks,q.docket FROM reference_receivers r JOIN questions q ON q.id=r.question_id WHERE r.question_id=${event.question_id}`;
    const receiver = receivers[0];
    const eventId = req.headers.get("sortition-event-id") || "";
    if (
      !receiver ||
      !verifySortitionWebhook(
        body,
        req.headers.get("sortition-signature") || "",
        decrypt(receiver.secret_ciphertext),
        eventId,
      )
    )
      return Response.json({ error: "Signature rejected" }, { status: 401 });
    const settlement = parseSettlement(
      {
        ...event,
        final: true,
        rounds: event.round,
        refunded: event.refunded === true,
      },
      {
        questionId: receiver.question_id,
        criteriaHash: receiver.criteria_hash,
        docketAddress: receiver.docket_address,
        network: receiver.network,
      },
    );
    const escrow = object(
      await readFinal(receiver.vault_address as Address, "get_account", [
        receiver.question_id,
      ]),
    );
    if (
      escrow.settled !== true ||
      escrow.outcome !== settlement.outcome ||
      Number(escrow.final_round) !== settlement.rounds
    )
      return Response.json(
        { error: "Final chain state does not match" },
        { status: 409 },
      );
    // A hearing that did not seat the panel its round was funded for is not
    // something a venue should settle money on, even with a valid signature.
    if (
      settlement.outcome !== "REFUNDED" &&
      panelVerified(
        receiver.panel_checks,
        receiver.docket?.rounds?.length || settlement.rounds,
      ) === false
    )
      return Response.json(
        { error: "A hearing in this docket did not seat its required panel" },
        { status: 409 },
      );
    const action =
      settlement.outcome === "REFUNDED" || settlement.outcome === "UNRESOLVABLE"
        ? "refund"
        : settlement.outcome === "YES"
          ? "pay_yes"
          : "pay_no";
    const inserted =
      await sql`INSERT INTO reference_settlements(question_id,event_id,outcome,action,body_hash) VALUES(${settlement.question_id},${eventId},${settlement.outcome},${action},${digest(body)}) ON CONFLICT(question_id) DO NOTHING RETURNING question_id`;
    return Response.json({
      accepted: true,
      duplicate: inserted.length === 0,
      action,
    });
  } catch {
    return Response.json(
      { error: "The settlement could not be verified." },
      { status: 503 },
    );
  }
}
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("question_id");
  if (!id || id.length > 80)
    return Response.json({ error: "Question ID required" }, { status: 400 });
  try {
    const rows =
      await db()`SELECT s.question_id,s.event_id,s.outcome,s.action,s.body_hash,s.received_at,r.venue,r.market_id,r.criteria_hash,r.docket_address,r.network FROM reference_settlements s JOIN reference_receivers r ON r.question_id=s.question_id WHERE s.question_id=${id}`;
    return rows[0]
      ? Response.json(rows[0], { headers: { "Cache-Control": "no-store" } })
      : Response.json(
          { error: "No verified reference settlement yet." },
          { status: 404 },
        );
  } catch {
    return Response.json(
      { error: "The reference record is unavailable." },
      { status: 503 },
    );
  }
}
