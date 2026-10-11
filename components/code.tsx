"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
export function Code({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="code-block">
      <pre>
        <code>{children}</code>
      </pre>
      <button
        className="icon-button"
        aria-label="Copy code"
        onClick={async () => {
          await navigator.clipboard.writeText(children);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );
}
