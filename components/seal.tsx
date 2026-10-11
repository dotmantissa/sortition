import { LockKeyhole } from "lucide-react";
export function CriteriaSeal({
  hash,
  large = false,
}: {
  hash?: string | null;
  large?: boolean;
}) {
  return (
    <div
      className={large ? "criteria-seal large" : "criteria-seal"}
      aria-label={
        hash ? "Criteria locked and hashed" : "Criteria locked at registration"
      }
    >
      <div className="seal-inner">
        <LockKeyhole size={large ? 30 : 20} strokeWidth={1.4} />
        <span>Criteria locked</span>
        <span className="seal-hash">
          {hash ? hash.slice(0, 8) : "Before the close"}
        </span>
      </div>
    </div>
  );
}
