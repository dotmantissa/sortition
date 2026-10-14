/** Public, explicitly synthetic fixtures for reproducible network acceptance tests. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const scenario = q.get("scenario");
  const timestamp = Number(q.get("observation"));
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp <= 0 ||
    timestamp > 4_000_000_000 ||
    !["event", "historical", "incomplete"].includes(scenario || "")
  )
    return new Response("Invalid test fixture", { status: 400 });
  const heading =
    "Synthetic Sortition acceptance-test evidence. This is not a real football market.\n";
  let text: string;
  if (scenario === "event") {
    text =
      heading +
      `The fixture match ended at Unix ${timestamp}. Trading stopped before kickoff. The final score is home 2, away 1. The result is final and the home team won. Published at Unix ${timestamp + 60}, after the event ended and trading closed.\n`;
  } else if (scenario === "historical") {
    const switchAt = Number(q.get("switch_at"));
    if (!Number.isSafeInteger(switchAt) || switchAt <= 0)
      return new Response("Invalid test fixture", { status: 400 });
    text =
      heading +
      (Date.now() / 1000 < switchAt
        ? `Historical bulletin for Unix ${timestamp}: the recorded rate is 6 percent. This is the original snapshot.\n`
        : `CORRECTION published after Unix ${timestamp}: the current recorded rate is 4 percent. This document replaces the original historical bulletin; current content does not establish what was authoritative earlier.\n`);
  } else {
    text =
      heading +
      "The final rate is 6 percent, which exceeds five percent.\n" +
      "x".repeat(290_000) +
      "\nQualification: the opening claim was retracted. No authoritative rate is available.\n" +
      "x".repeat(60_000);
  }
  return new Response(text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
