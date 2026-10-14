/** Imports a real venue question. Sortition does not change Polymarket's resolver. */
import { parseSettlement, type SettlementPin } from "../lib/settlement";
import { specificationSchema } from "../lib/validation";
import type { Source, Specification } from "../lib/types";
export async function importPolymarket(slug: string) {
  if (!/^[a-z0-9-]{1,200}$/.test(slug)) throw Error("Invalid market slug");
  const response = await fetch(
    `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`,
    { signal: AbortSignal.timeout(10000) },
  );
  if (!response.ok) throw Error("Venue request failed");
  let markets = await response.json();
  if (Array.isArray(markets) && !markets.length) {
    const closed = await fetch(
      `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&closed=true`,
      { signal: AbortSignal.timeout(10000) },
    );
    if (!closed.ok) throw Error("Venue request failed");
    markets = await closed.json();
  }
  const market = markets[0];
  if (!market) throw Error("Market not found");
  const outcomes: unknown =
    typeof market.outcomes === "string"
      ? JSON.parse(market.outcomes)
      : market.outcomes;
  if (
    !Array.isArray(outcomes) ||
    outcomes.length !== 2 ||
    outcomes.some((value) => typeof value !== "string")
  )
    throw Error("Only binary venue questions are supported");
  return {
    ...market,
    outcomes: outcomes as string[],
    description: `${market.description || ""}\n\nSortition outcome mapping: YES means ${JSON.stringify(outcomes[0])}. NO means ${JSON.stringify(outcomes[1])}. A split payout or unresolved event is UNRESOLVABLE. Extract a canonical value in the form result=<winning outcome in lowercase> for a final result, or result=unknown otherwise.`,
  } as {
    id: string;
    question: string;
    description: string;
    endDate: string;
    resolutionSource: string;
    outcomes: string[];
  };
}
export async function registerPolymarketQuestion({
  slug,
  sources,
  unresolvableDefinition,
  closeTimestamp,
  observationTimestamp,
  resolutionTimestamp,
  disagreementRule,
  tieBreakUrl,
  webhook,
  idempotencyKey,
}: {
  slug: string;
  sources: Source[];
  unresolvableDefinition: string;
  closeTimestamp: number;
  observationTimestamp?: number;
  resolutionTimestamp?: number;
  disagreementRule: Specification["disagreement_rule"];
  tieBreakUrl: string;
  webhook?: { url: string; secret: string };
  idempotencyKey?: string;
}) {
  const market = await importPolymarket(slug);
  const specification = specificationSchema.parse({
    question: market.question,
    criteria: market.description,
    sources,
    unresolvable_definition: unresolvableDefinition,
    close_timestamp: closeTimestamp,
    observation_timestamp: observationTimestamp ?? closeTimestamp,
    resolution_timestamp:
      resolutionTimestamp ?? observationTimestamp ?? closeTimestamp,
    evidence_mode: "event_outcome",
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
      "Idempotency-Key": idempotencyKey || crypto.randomUUID(),
    },
    body: JSON.stringify({
      specification,
      fee: "0",
      base_bond: "1",
      ...(webhook ? { webhook } : {}),
    }),
  });
  if (!response.ok) throw Error("Sortition registration failed");
  return response.json() as Promise<{ id: string; operation_id: string }>;
}
export async function consumeFinalSettlement(pin: Required<SettlementPin>) {
  const response = await fetch(
    `${process.env.SORTITION_URL}/api/questions/${encodeURIComponent(pin.questionId)}/settlement`,
  );
  if (!response.ok) throw Error("Settlement request failed");
  const settlement = parseSettlement(await response.json(), pin);
  if (!settlement.final) return null;
  if (!["YES", "NO", "UNRESOLVABLE", "REFUNDED"].includes(settlement.outcome))
    throw Error("Unexpected verdict");
  return {
    venueAction:
      settlement.outcome === "UNRESOLVABLE" || settlement.outcome === "REFUNDED"
        ? "refund"
        : settlement.outcome === "YES"
          ? "pay_yes"
          : "pay_no",
    settlement,
  };
}
