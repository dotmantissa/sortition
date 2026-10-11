"use client";
import { JuryReceipt } from "./jury-receipt";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LockKeyhole,
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  Download,
  Scale,
  CircleHelp,
  RefreshCw,
  LoaderCircle,
  Radio,
  Mail,
  CircleAlert,
} from "lucide-react";
import { CriteriaSeal } from "./seal";
import { Status } from "./status";
import type { Question, Outcome } from "@/lib/types";
function date(t: number) {
  return (
    new Date(t * 1000).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }) + " UTC"
  );
}
export function Docket({ initial }: { initial: Question }) {
  const [q, setQ] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expected, setExpected] = useState<Outcome>("NO");
  const [time, setTime] = useState(0);
  const { authenticated, login, getAccessToken } = usePrivy();
  const latest = q.docket?.rounds.at(-1);
  const active = q.operations?.some((o) =>
    ["queued", "submitted", "submitting", "needs_review"].includes(o.status),
  );
  const refresh = useCallback(async () => {
    try {
      const token = authenticated ? await getAccessToken() : null;
      const r = await fetch(`/api/questions/${initial.id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw Error();
      setQ(await r.json());
      const clock = await fetch("/api/network");
      if (clock.ok) setTime((await clock.json()).unix);
    } catch {
      setError(
        "The docket could not refresh. The last recorded evidence is still here.",
      );
    }
  }, [authenticated, getAccessToken, initial.id]);
  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      refresh();
    }, 15000);
    return () => clearInterval(t);
  }, [refresh]);
  async function action(kind: string) {
    if (!authenticated) {
      login();
      return;
    }
    setBusy(true);
    setError("");
    try {
      const token = await getAccessToken();
      const r = await fetch(`/api/questions/${q.id}/actions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ action: kind, expected_outcome: expected }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      await refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The action could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }
  const outcome = q.escrow?.settled ? q.escrow.outcome : latest?.outcome;
  const appealOpen =
    time > 0 && !!latest && latest.deadline > time && !q.escrow?.settled;
  const nextBond =
    BigInt(q.base_bond) * 2n ** BigInt(q.escrow?.challenge_count || 0);
  return (
    <div className="docket-page">
      <div className="breadcrumbs">
        <Link href="/">The docket</Link>
        <ChevronRight size={13} />
        <span>Question record</span>
      </div>
      <header className="docket-title">
        <div>
          <div className="section-context">
            <Radio size={15} />
            {q.specification.venue?.name || "Independent market"}
            <Status value={q.status} />
          </div>
          <h1>{q.specification.question}</h1>
          <p>
            Closes {date(q.specification.close_timestamp)}.{" "}
            {q.specification.sources.length} sources, locked at registration.
          </p>
        </div>
        <CriteriaSeal hash={q.criteria_hash} />
      </header>
      <div className="docket-body">
        <div className="docket-main">
          {error ? (
            <div className="alert error" role="alert">
              <CircleAlert size={17} />
              {error}
            </div>
          ) : null}
          <section className="docket-section">
            <h2>The agreed criteria</h2>
            <p>{q.specification.criteria}</p>
            <dl>
              <dt>When sources disagree</dt>
              <dd>
                {q.specification.disagreement_rule === "unanimous"
                  ? "Every registered source must be reachable and agree."
                  : q.specification.disagreement_rule === "majority"
                    ? "More than half of all registered sources must support the same answer. Missing sources still count in the denominator."
                    : "Every source must be reachable and give a clear answer. If they disagree, the named tie source decides."}
              </dd>
              <dt>Unresolvable when</dt>
              <dd>{q.specification.unresolvable_definition}</dd>
            </dl>
          </section>
          <section className="docket-section">
            <h2>The locked source set</h2>
            <p>No source can join this list after registration.</p>
            {q.specification.sources.map((s) => {
              const reading = latest?.sources.find((r) => r.url === s.url);
              return (
                <article className="source-record" key={s.url}>
                  <header>
                    <h3>
                      <LockKeyhole size={15} />
                      {s.name}
                    </h3>
                    {s.url === q.specification.tie_break_url ? (
                      <span className="tie-tag">Named tie source</span>
                    ) : null}
                  </header>
                  <a href={s.url} target="_blank" rel="noreferrer">
                    {s.url}
                  </a>
                  {reading ? (
                    <>
                      <p>
                        {reading.reachable
                          ? "Source reached by the jury"
                          : "Source could not be reached"}
                      </p>
                      {reading.value ? (
                        <p className="evidence-value">
                          Extracted value: {reading.value}
                        </p>
                      ) : null}
                      {reading.excerpt ? (
                        <blockquote>{reading.excerpt}</blockquote>
                      ) : null}
                      {reading.digest ? (
                        <code>Evidence digest {reading.digest}</code>
                      ) : null}
                    </>
                  ) : (
                    <p>Evidence is fetched when the question resolves.</p>
                  )}
                </article>
              );
            })}
          </section>
          <section className="docket-section">
            <div className="round-header">
              <h2>Every hearing</h2>
              <button
                className="icon-button"
                aria-label="Refresh record"
                onClick={refresh}
              >
                <RefreshCw size={17} />
              </button>
            </div>
            {q.docket?.rounds.length ? (
              q.docket.rounds.map((r) => (
                <article className="round-record" key={r.round}>
                  <div className="round-header">
                    <h3>Round {r.round}</h3>
                    <Status value={r.outcome} />
                  </div>
                  <p>Evidence read {date(r.resolved_at)}.</p>
                  <p>Bonded challenge window closes {date(r.deadline)}.</p>
                  <details className="receipt-details">
                    <summary>
                      <Scale size={15} /> Inspect every source reading
                    </summary>
                    <pre>{JSON.stringify(r.sources, null, 2)}</pre>
                  </details>
                </article>
              ))
            ) : (
              <div className="round-record">
                <h3>The jury hasn’t heard this question yet.</h3>
                <p>
                  {q.status === "registering"
                    ? "Registration is being processed. The factory creates the docket once the transaction finalizes."
                    : time < q.specification.close_timestamp
                      ? "The rules are sealed. Evidence will be read after the question closes."
                      : "The question has closed. A funded resolution request starts the hearing."}
                </p>
              </div>
            )}
          </section>
          <section className="docket-section">
            <h2>Consensus receipts</h2>
            <p>The network’s own record of juries, votes, and rotations.</p>
            {q.receipts?.length ? (
              q.receipts.map((r) => {
                const validators = Array.isArray(r.receipt.validators)
                  ? (r.receipt.validators as {
                      address?: string;
                      vote?: string;
                    }[])
                  : [];
                return (
                  <article key={r.tx_hash} className="round-record">
                    <div className="round-header">
                      <h3>
                        {r.kind === "internal"
                          ? r.receipt.transaction_type === 0
                            ? "Native payment"
                            : "Contract message"
                          : r.kind.replaceAll("_", " ")}
                      </h3>
                      <span className="status">
                        {r.receipt.status === "FINALIZED" &&
                        r.receipt.execution_success === false
                          ? "Execution failed"
                          : String(r.receipt.status || "Recorded")}
                      </span>
                    </div>
                    <a
                      className="receipt-link"
                      href={`https://studio.genlayer.com/transactions/${r.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {r.tx_hash.slice(0, 16)}…{r.tx_hash.slice(-8)}
                      <ExternalLink size={12} />
                    </a>
                    {validators.length ? (
                      <p>
                        {validators.length} validator receipts recorded.{" "}
                        {validators.filter((v) => v.vote === "agree").length}{" "}
                        agreed.
                      </p>
                    ) : null}
                    {typeof r.receipt.rotation_count === "number" &&
                    r.receipt.rotation_count > 0 ? (
                      <p>
                        {r.receipt.rotation_count} jury rotations recorded by
                        the network.
                      </p>
                    ) : null}
                    {r.receipt.transaction_type === 0 ? (
                      <p>
                        Native value: {String(r.receipt.value || "0")} GEN wei.
                        Recipient:{" "}
                        <code className="breakable">
                          {String(r.receipt.recipient || "Not reported")}
                        </code>
                      </p>
                    ) : null}
                    <JuryReceipt receipt={r.receipt} />
                    <details className="receipt-details">
                      <summary>
                        <Scale size={15} /> Inspect jury and evidence receipt
                      </summary>
                      <pre>{JSON.stringify(r.receipt, null, 2)}</pre>
                    </details>
                  </article>
                );
              })
            ) : (
              <p>Receipts appear here as the network processes each action.</p>
            )}
          </section>
        </div>
        <aside className="docket-rail">
          <section className="verdict-panel">
            <h2>The current verdict</h2>
            <div className="verdict-word">
              {outcome === "YES"
                ? "Yes."
                : outcome === "NO"
                  ? "No."
                  : outcome === "UNRESOLVABLE"
                    ? "Unresolvable."
                    : "Awaiting a hearing."}
            </div>
            <p>
              {outcome === "UNRESOLVABLE"
                ? "The evidence does not meet the agreed rules. That is an answer worth keeping."
                : q.escrow?.settled
                  ? "The appeal window has closed and settlement is final."
                  : latest
                    ? "Recorded by consensus. Settlement follows when the appeal window closes."
                    : "No verdict has been recorded."}
            </p>
          </section>
          <section>
            <h3>
              <LockKeyhole size={16} /> Criteria fingerprint
            </h3>
            {q.criteria_hash ? (
              <>
                <code>{q.criteria_hash}</code>
                <button
                  className="button secondary"
                  onClick={async () => {
                    await navigator.clipboard.writeText(q.criteria_hash!);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={15} /> : <Copy size={15} />}{" "}
                  {copied ? "Copied" : "Copy fingerprint"}
                </button>
              </>
            ) : (
              <p>The fingerprint arrives with registration.</p>
            )}
            {q.docket_address ? (
              <>
                <p>Docket address</p>
                <code>{q.docket_address}</code>
              </>
            ) : null}
          </section>
          <section>
            <h3>Take the next action</h3>
            {!authenticated ? (
              <>
                <p>
                  Sign in with email to participate. We handle the transaction.
                </p>
                <button className="button primary" onClick={() => login()}>
                  <Mail size={15} />
                  Continue with email
                </button>
              </>
            ) : (
              <>
                {q.can_operate &&
                !latest &&
                time >= q.specification.close_timestamp &&
                q.escrow?.funded ? (
                  <button
                    className="button primary"
                    disabled={busy || active || !time}
                    onClick={() => action("resolve")}
                  >
                    {busy ? (
                      <LoaderCircle className="spinning" size={16} />
                    ) : (
                      <Scale size={16} />
                    )}
                    Request resolution
                  </button>
                ) : null}
                {q.can_operate && q.escrow && !q.escrow.funded ? (
                  <button
                    className="button primary"
                    disabled={busy || active || !time}
                    onClick={() => action("fund")}
                  >
                    Fund the resolution fee
                  </button>
                ) : null}
                {appealOpen ? (
                  <>
                    <p>
                      A different reading deserves a hearing. The next bond is{" "}
                      {nextBond.toString()} GEN wei, sponsored by the relay.
                    </p>
                    <label>
                      Outcome you are arguing for
                      <select
                        value={expected}
                        onChange={(e) => setExpected(e.target.value as Outcome)}
                      >
                        {(["YES", "NO", "UNRESOLVABLE"] as Outcome[])
                          .filter((v) => v !== latest?.outcome)
                          .map((v) => (
                            <option key={v} value={v}>
                              {v === "UNRESOLVABLE"
                                ? "Unresolvable"
                                : v === "YES"
                                  ? "Yes"
                                  : "No"}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="button secondary"
                      disabled={busy || active || expected === latest?.outcome}
                      onClick={() => action("challenge")}
                    >
                      Request a bonded hearing
                    </button>
                  </>
                ) : null}
                {q.can_operate &&
                latest &&
                !appealOpen &&
                !q.escrow?.settled ? (
                  <button
                    className="button primary"
                    disabled={busy || active || !time}
                    onClick={() => action("finalize")}
                  >
                    Finalize settlement
                  </button>
                ) : null}
                {q.escrow?.settled && q.credit && BigInt(q.credit) > 0n ? (
                  <button
                    className="button secondary"
                    disabled={busy || active || !time}
                    onClick={() => action("withdraw")}
                  >
                    Withdraw settlement credit
                  </button>
                ) : null}
                {q.operations?.some(
                  (o) => o.kind === "resolve" && o.status === "submitted",
                ) ? (
                  <>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => action("protocol_appeal")}
                    >
                      Appeal the protocol decision
                    </button>
                    <p className="docket-action-note">
                      A protocol appeal rotates the jury and increases its
                      panel. The network decides whether the window is still
                      open.
                    </p>
                  </>
                ) : null}
                {q.operations?.map((o) => (
                  <div key={o.id}>
                    <div className="operation-row">
                      <span>{o.kind.replaceAll("_", " ")}</span>
                      <span>{o.status.replaceAll("_", " ")}</span>
                    </div>
                    {o.error ? (
                      <p className="operation-error">{o.error}</p>
                    ) : null}
                  </div>
                ))}
                {active ? (
                  <p className="docket-action-note">
                    An action is in progress. This page checks for updates
                    automatically.
                  </p>
                ) : null}
              </>
            )}
          </section>
          <section>
            <h3>Keep the whole record</h3>
            <button
              className="button secondary"
              onClick={() => {
                const blob = new Blob([JSON.stringify(q, null, 2)], {
                  type: "application/json",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `sortition-${q.id}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download size={15} />
              Download docket
            </button>
            <Link
              className="button secondary"
              href={`/api/questions/${q.id}/settlement`}
            >
              <CircleHelp size={15} />
              Read settlement JSON
            </Link>
          </section>
        </aside>
      </div>
    </div>
  );
}
