/** Imports a real venue question. Sortition does not change Polymarket's resolver. */
import { specificationSchema } from "../lib/validation";
import type { Source, Specification } from "../lib/types";
export async function importPolymarket(slug: string) {
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) throw Error("Invalid market slug");
  const response = await fetch(
    `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw Error("Venue request failed");
  const markets = await response.json();
  const market = markets[0];
  if (!market) throw Error("Market not found");
  return market as {
    id: string;
    question: string;
    description: string;
    endDate: string;
    resolutionSource: string;
  };
}
export async function registerPolymarketQuestion({
  slug,
  sources,
  unresolvableDefinition,
  closeTimestamp,
  disagreementRule,
  tieBreakUrl,
}: {
  slug: string;
  sources: Source[];
  unresolvableDefinition: string;
  closeTimestamp: number;
  disagreementRule: Specification["disagreement_rule"];
  tieBreakUrl: string;
}) {
  const market = await importPolymarket(slug);
  const specification = specificationSchema.parse({
    question: market.question,
    criteria: market.description,
    sources,
    unresolvable_definition: unresolvableDefinition,
    close_timestamp: closeTimestamp,
    disagreement_rule: disagreementRule,
    tie_break_url: tieBreakUrl,
    venue: {
      name: "Polymarket",
      market_id: String(market.id),
      url: `https://polymarket.com/event/${slug}`,
    },
  });
  const response = await fetch(`${process.env.SORTITION_URL}/api/questions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SORTITION_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
    },
    body: JSON.stringify({ specification, fee: "0", base_bond: "1" }),
  });
  if (!response.ok) throw Error("Sortition registration failed");
  return response.json() as Promise<{ id: string; operation_id: string }>;
}
export async function consumeFinalSettlement(questionId: string) {
  const response = await fetch(
    `${process.env.SORTITION_URL}/api/questions/${encodeURIComponent(questionId)}/settlement`,
  );
  if (!response.ok) throw Error("Settlement request failed");
  const settlement = await response.json();
  if (!settlement.final) return null;
  if (!["YES", "NO", "UNRESOLVABLE"].includes(settlement.outcome))
    throw Error("Unexpected verdict");
  return {
    venueAction:
      settlement.outcome === "UNRESOLVABLE"
        ? "refund"
        : settlement.outcome === "YES"
          ? "pay_yes"
          : "pay_no",
    settlement,
  };
}
