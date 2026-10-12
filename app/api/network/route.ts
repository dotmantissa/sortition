import { nativeAppealsEnabled } from "@/lib/lifecycle";
import { networkClock } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    return Response.json(
      {
        network: "studionet",
        native_protocol_appeals: nativeAppealsEnabled,
        ...(await networkClock()),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Network time is unavailable." },
      { status: 503 },
    );
  }
}
