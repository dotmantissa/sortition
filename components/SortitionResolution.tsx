"use client";
import { useEffect, useRef, useState } from "react";
import { LockKeyhole, ExternalLink } from "lucide-react";
import {
  parseSettlement,
  settlementIdentity,
  type Settlement,
} from "../lib/settlement";
export type { Settlement } from "../lib/settlement";
/** Display and notification only. Venue payouts need their own durable deduplication. */
export function SortitionResolution({
  questionId,
  baseUrl = "",
  onSettled,
  criteriaHash,
  docketAddress,
  network = "studionet",
}: {
  questionId: string;
  baseUrl?: string;
  criteriaHash?: string;
  docketAddress?: string;
  network?: string;
  onSettled?: (settlement: Settlement) => void;
}) {
  const key = JSON.stringify([
    baseUrl,
    questionId,
    criteriaHash,
    docketAddress,
    network,
  ]);
  const [record, setRecord] = useState<{
    key: string;
    data: Settlement | null;
    error: boolean;
  }>({ key, data: null, error: false });
  const callback = useRef(onSettled);
  const notified = useRef(new Set<string>());
  useEffect(() => {
    callback.current = onSettled;
  }, [onSettled]);
  useEffect(() => {
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    const read = async () => {
      if (inFlight) return;
      inFlight = true;
      let final: Settlement | null = null;
      try {
        const response = await fetch(
          `${baseUrl}/api/questions/${encodeURIComponent(questionId)}/settlement`,
          {
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(12000),
            ]),
            cache: "no-store",
          },
        );
        if (!response.ok) throw Error("Record unavailable");
        const data = parseSettlement(await response.json(), {
          questionId,
          criteriaHash,
          docketAddress,
          network,
        });
        if (active) {
          setRecord({ key, data, error: false });
          if (data.final) final = data;
        }
      } catch {
        if (active) setRecord({ key, data: null, error: true });
      } finally {
        inFlight = false;
      }
      if (final && callback.current) {
        const identity = baseUrl + ":" + settlementIdentity(final);
        if (!notified.current.has(identity)) {
          notified.current.add(identity);
          callback.current(final);
        }
      }
    };
    void read();
    const timer = setInterval(() => {
      void read();
    }, 15000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [baseUrl, questionId, criteriaHash, docketAddress, network, key]);
  // A new question never renders the previous question's data, even before effects run.
  const data = record.key === key ? record.data : null;
  const error = record.key === key && record.error;
  return (
    <div className="resolution-widget">
      <div>
        <strong>Sortition resolution</strong>
        <LockKeyhole size={17} />
      </div>
      <p aria-live="polite">
        {error
          ? "The record could not be verified."
          : !data
            ? "Reading the public record…"
            : !data.final
              ? "Waiting for final settlement."
              : data.outcome === "REFUNDED"
                ? "Refunded. The funded hearing passed its deadline without a ruling, so every payer was repaid."
                : data.outcome === "UNRESOLVABLE"
                  ? "Unresolvable. The agreed evidence did not support a verdict."
                  : data.outcome === "YES"
                    ? "Final verdict: Yes."
                    : "Final verdict: No."}
      </p>
      <p className="resolution-caveat">
        {data?.final && data.panel_verified === false
          ? "A hearing in this docket did not seat its required panel. Check the receipts before settling anything of value."
          : data?.stale
            ? "This record is indexed state and is currently lagging. Read the docket for the live position."
            : null}
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
