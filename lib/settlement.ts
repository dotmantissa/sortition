export type Settlement = {
  question_id: string;
  outcome: "YES" | "NO" | "UNRESOLVABLE" | "PENDING";
  final: boolean;
  criteria_hash: string | null;
  docket_address: string | null;
  network: string;
  rounds: number;
};
export type SettlementPin = {
  questionId: string;
  criteriaHash?: string;
  docketAddress?: string;
  network?: string;
};
export function parseSettlement(raw: unknown, pin: SettlementPin): Settlement {
  if (!raw || typeof raw !== "object") throw Error("Invalid settlement record");
  const s = raw as Settlement;
  if (
    s.question_id !== pin.questionId ||
    !["YES", "NO", "UNRESOLVABLE", "PENDING"].includes(s.outcome) ||
    typeof s.final !== "boolean" ||
    !Number.isSafeInteger(s.rounds) ||
    s.rounds < 0 ||
    typeof s.network !== "string" ||
    !s.network ||
    (s.criteria_hash !== null && !/^[a-f0-9]{64}$/.test(s.criteria_hash)) ||
    (s.docket_address !== null && !/^0x[a-fA-F0-9]{40}$/.test(s.docket_address))
  )
    throw Error("Invalid settlement record");
  if (
    s.final
      ? s.outcome === "PENDING" ||
        s.rounds < 1 ||
        !s.criteria_hash ||
        !s.docket_address
      : s.outcome !== "PENDING"
  )
    throw Error("Settlement finality is inconsistent");
  if (pin.network && s.network !== pin.network)
    throw Error("Settlement network changed");
  if (
    pin.criteriaHash &&
    (s.final || s.criteria_hash !== null) &&
    s.criteria_hash !== pin.criteriaHash
  )
    throw Error("Locked criteria do not match");
  if (
    pin.docketAddress &&
    (s.final || s.docket_address !== null) &&
    s.docket_address?.toLowerCase() !== pin.docketAddress.toLowerCase()
  )
    throw Error("Docket address does not match");
  return s;
}
export function settlementIdentity(s: Settlement) {
  return JSON.stringify([
    s.network,
    s.question_id,
    s.criteria_hash,
    s.docket_address?.toLowerCase(),
    s.rounds,
    s.outcome,
  ]);
}
