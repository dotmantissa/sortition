import { HttpError, fail } from "@/lib/auth";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  try {
    let slug = new URL(req.url).searchParams.get("slug") || "";
    if (slug.startsWith("https://")) {
      const u = new URL(slug);
      if (u.hostname !== "polymarket.com")
        throw new HttpError(400, "Use a Polymarket URL or market slug.");
      slug = u.pathname.split("/").filter(Boolean).at(-1) || "";
    }
    if (!/^[a-z0-9-]{1,200}$/.test(slug))
      throw new HttpError(400, "Paste a market slug or its Polymarket URL.");
    const r = await fetch(
      `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`,
      { signal: AbortSignal.timeout(10000), cache: "no-store" },
    );
    if (!r.ok)
      throw new HttpError(
        502,
        "Polymarket is taking a moment. Please try again.",
      );
    const markets = await r.json();
    const m = markets[0];
    if (!m)
      throw new HttpError(
        404,
        "We could not find that market. Use the individual market slug.",
      );
    return Response.json({
      id: String(m.id),
      question: m.question,
      description: m.description || "",
      end_date: m.endDate || null,
      resolution_source: m.resolutionSource || null,
      url: `https://polymarket.com/event/${slug}`,
      closed: !!m.closed,
    });
  } catch (e) {
    return fail(e);
  }
}
