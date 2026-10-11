"use client";
import { useEffect, useState } from "react";
import { LockKeyhole, ExternalLink } from "lucide-react";
export type Settlement = {
  question_id: string;
  outcome: "YES" | "NO" | "UNRESOLVABLE" | "PENDING";
  final: boolean;
  criteria_hash: string | null;
  docket_address: string | null;
  network: string;
  rounds: number;
};
/** Read-only widget. Never settles a consumer from a provisional verdict. */
export function SortitionResolution({
  questionId,
  baseUrl = "",
  onSettled,
}: {
  questionId: string;
  baseUrl?: string;
  onSettled?: (settlement: Settlement) => void;
}) {
  const [data, setData] = useState<Settlement | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true,
      notified = false;
    const controller = new AbortController();
    const read = async () => {
      try {
        const r = await fetch(
          `${baseUrl}/api/questions/${encodeURIComponent(questionId)}/settlement`,
          { signal: controller.signal },
        );
        if (!r.ok) throw Error();
        const d = (await r.json()) as Settlement;
        if (
          !["YES", "NO", "UNRESOLVABLE", "PENDING"].includes(d.outcome) ||
          d.question_id !== questionId
        )
          throw Error();
        if (active) {
          setData(d);
          setError(false);
          if (d.final && !notified) {
            notified = true;
            onSettled?.(d);
          }
        }
      } catch {
        if (active) setError(true);
      }
    };
    read();
    const timer = setInterval(read, 15000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [questionId, baseUrl, onSettled]);
  return (
    <div className="resolution-widget">
      <div>
        <strong>Sortition resolution</strong>
        <LockKeyhole size={17} />
      </div>
      <p aria-live="polite">
        {error
          ? "The record could not be reached."
          : !data
            ? "Reading the public record…"
            : !data.final
              ? "Waiting for final settlement."
              : data.outcome === "UNRESOLVABLE"
                ? "Unresolvable. The agreed evidence did not support a verdict."
                : data.outcome === "YES"
                  ? "Final verdict: Yes."
                  : "Final verdict: No."}
      </p>
      <a
        href={`${baseUrl}/dockets/${encodeURIComponent(questionId)}`}
        target="_blank"
        rel="noreferrer"
      >
        Read the public docket <ExternalLink size={13} />
      </a>
    </div>
  );
}
