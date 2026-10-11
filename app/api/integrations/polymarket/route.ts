import { HttpError, fail } from "@/lib/auth";
import { importPolymarket } from "@/integrations/polymarket";
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
    const m = await importPolymarket(slug);
    return Response.json({
      id: String(m.id),
      question: m.question,
      description: m.description || "",
      end_date: m.endDate || null,
      resolution_source: m.resolutionSource || null,
      outcomes: m.outcomes,
      url: `https://polymarket.com/event/${slug}`,
    });
  } catch (e) {
    return fail(e);
  }
}
