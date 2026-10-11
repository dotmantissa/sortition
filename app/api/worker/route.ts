import { workerTick } from "@/lib/worker";
import { safeEqual } from "@/lib/security";
import { env } from "@/lib/env";
export const maxDuration = 60;
export async function POST(req: Request) {
  if (
    !safeEqual(
      req.headers.get("authorization") || "",
      `Bearer ${env("WORKER_SECRET")}`,
    )
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    return Response.json(await workerTick());
  } catch {
    return Response.json(
      { error: "Worker could not complete this tick." },
      { status: 503 },
    );
  }
}
