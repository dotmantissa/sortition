import { CircleCheck, CircleHelp, Clock3, LoaderCircle } from "lucide-react";
export function Status({ value }: { value: string }) {
  const text =
    value === "UNRESOLVABLE"
      ? "Unresolvable"
      : value === "YES"
        ? "Yes"
        : value === "NO"
          ? "No"
          : value === "registering"
            ? "Registering"
            : value === "awaiting_fee"
              ? "Awaiting fee"
              : value === "settled"
                ? "Settled"
                : value === "open"
                  ? "Open"
                  : value === "ready"
                    ? "Ready to resolve"
                    : value === "resolved"
                      ? "Appeal window"
                      : value === "failed"
                        ? "Needs attention"
                        : "In progress";
  const Icon =
    value === "UNRESOLVABLE"
      ? CircleHelp
      : ["YES", "NO", "settled"].includes(value)
        ? CircleCheck
        : value === "registering"
          ? LoaderCircle
          : Clock3;
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      <Icon size={14} />
      {text}
    </span>
  );
}
