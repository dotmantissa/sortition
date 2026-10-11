import { Check, CircleMinus, Scale } from "lucide-react";
import type { Evidence } from "@/lib/types";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function participants(value: unknown) {
  return Array.isArray(value) ? value.map(record) : [];
}
export function JuryReceipt({ receipt }: { receipt: Record<string, unknown> }) {
  const members = [
    ...participants(receipt.leaders).filter(
      (member) => member.mode === "leader",
    ),
    ...participants(receipt.validators),
  ];
  if (!members.length) return null;
  return (
    <div className="jury-list">
      {members.map((member, index) => {
        const reads = participants(member.source_reads);
        const evidence = reads.flatMap((read) =>
          Array.isArray(read.sources) ? (read.sources as Evidence[]) : [],
        );
        const label = member.mode === "leader" ? "Leader" : "Validator";
        const vote = String(
          member.vote || (member.mode === "leader" ? "proposed" : "unreported"),
        );
        return (
          <details key={`${String(member.address)}:${index}`} className="juror">
            <summary>
              <span>
                {vote === "agree" ? (
                  <Check size={15} />
                ) : vote === "idle" ? (
                  <CircleMinus size={15} />
                ) : (
                  <Scale size={15} />
                )}
                {label}
              </span>
              <code>
                {member.address
                  ? `${String(member.address).slice(0, 8)}…${String(member.address).slice(-6)}`
                  : "Address unreported"}
              </code>
              <span className="juror-vote">{vote}</span>
            </summary>
            {evidence.length ? (
              evidence.map((source, i) => (
                <div className="juror-reading" key={`${source.url}:${i}`}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.name}
                  </a>
                  <p>
                    {source.reachable ? "Source reached" : "Source unavailable"}{" "}
                    · <strong>{source.value || "No extracted value"}</strong>
                  </p>
                  {source.excerpt ? (
                    <blockquote>{source.excerpt}</blockquote>
                  ) : null}
                  {source.digest ? (
                    <details>
                      <summary>Evidence digest</summary>
                      <code className="breakable">{source.digest}</code>
                    </details>
                  ) : null}
                </div>
              ))
            ) : (
              <p className="juror-note">
                {vote === "idle"
                  ? "The network reached quorum before this reading completed."
                  : "This receipt does not report a completed source reading. Its full record is available below."}
              </p>
            )}
          </details>
        );
      })}
    </div>
  );
}
