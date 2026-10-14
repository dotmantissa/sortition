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
import {
  fundedRehearing,
  protocolAppealable,
  nativeAppealsEnabled,
} from "@/lib/lifecycle";
import { maximumSponsoredPayment } from "@/lib/sponsor-limits";
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
  const latest = q.docket?.rounds?.at(-1);
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
  const pendingRehearing = fundedRehearing(
    q.escrow,
    q.docket?.rounds?.length || 0,
  );
  const waitingWindow =
    Number(q.escrow?.version) >= 2 &&
    !!latest &&
    Number(q.escrow?.opened_round) < latest.round;
  const deadline =
    Number(q.escrow?.version) >= 2
      ? Number(q.escrow?.round_deadline || 0)
      : Number(latest?.deadline || 0);
  const appealOpen =
    time > 0 &&
    !!latest &&
    deadline > time &&
    !q.escrow?.settled &&
    !pendingRehearing &&
    !waitingWindow;
  const nativeAppeal = q.receipts?.filter((r) => r.kind === "resolve").at(-1);
  const nativeAppealOpen =
    nativeAppealsEnabled &&
    !!nativeAppeal &&
    protocolAppealable(String(nativeAppeal.receipt.status));
  const nextBond =
    BigInt(q.base_bond) * 2n ** BigInt(q.escrow?.challenge_count || 0);
  const openToAnyone =
    time > 0 &&
    !!q.docket?.open_to_anyone_after &&
    time >= Number(q.docket.open_to_anyone_after);
  const panelCheck = (round: number) =>
    q.panel_checks?.find((check) => Number(check.round) === round) || null;
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
            Resolution eligible{" "}
            {date(
              q.specification.resolution_timestamp ??
                q.specification.close_timestamp,
            )}
            . {q.specification.sources.length} sources, locked at registration.
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
          {q.archived ? (
            <div className="alert" role="status">
              <LockKeyhole size={17} />
              <p>
                {q.archive_reason ||
                  "This docket uses an earlier resolver. Its record is preserved, but new fees and bonds belong in a question registered with the current contracts."}
              </p>
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
                      {reading.evidence_reason ? (
                        <p>
                          {reading.evidence_reason === "incomplete_document"
                            ? "This document exceeds the inspection limit. Its omitted portions cannot support a conclusive outcome."
                            : reading.evidence_reason ===
                                "historical_snapshot_mismatch"
                              ? "This retrieved document differs from the locked historical snapshot."
                              : "The evidence does not establish the state at the required observation time."}
                        </p>
                      ) : null}
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
            {q.docket?.candidates
              ?.filter((c) => c.jury_status !== "verified")
              .map((c) => (
                <div className="juror-note" key={c.candidate_id}>
                  Hearing candidate: {c.outcome}.{" "}
                  {c.jury_status === "rejected"
                    ? "Jury rejected: insufficient independently completed validators. This candidate cannot settle the market. Retry the funded round or claim its timeout refund."
                    : "Awaiting finalized jury verification; settlement remains pending."}
                  {c.tx_hash ? (
                    <a
                      href={`https://explorer-studio.genlayer.com/tx/${c.tx_hash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {" "}
                      View receipt
                    </a>
                  ) : null}
                </div>
              ))}
            {q.docket?.rounds?.length ? (
              q.docket.rounds.map((r) => (
                <article className="round-record" key={r.round}>
                  <div className="round-header">
                    <h3>Round {r.round}</h3>
                    <Status value={r.outcome} />
                  </div>
                  <p>Evidence read {date(r.resolved_at)}.</p>
                  {r.round === latest?.round && !q.escrow?.settled ? (
                    <p>
                      {pendingRehearing
                        ? "A funded rehearing is waiting for its jury."
                        : waitingWindow
                          ? "The finalized jury is opening a fresh challenge window."
                          : `Bonded challenge window closes ${date(deadline)}.`}
                    </p>
                  ) : (
                    <p>This hearing is preserved in the public record.</p>
                  )}
                  {panelCheck(r.round) ? (
                    <p>
                      Panel funded for {panelCheck(r.round)!.required},
                      completed {panelCheck(r.round)!.observed} unique members
                      with {panelCheck(r.round)!.independent_validators}{" "}
                      independent validator
                      {panelCheck(r.round)!.independent_validators === 1
                        ? ""
                        : "s"}
                      .{" "}
                      {panelCheck(r.round)!.verified
                        ? "The receipt meets the panel this round was funded for."
                        : "The receipt does not meet the panel this round was funded for. Read it before settling anything of value."}
                    </p>
                  ) : r.required_validators ? (
                    <p>
                      This round was funded for a panel of{" "}
                      {r.required_validators}. Its receipt has not been checked
                      against that commitment yet.
                    </p>
                  ) : null}
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
                    : time <
                        (q.specification.resolution_timestamp ??
                          q.specification.close_timestamp)
                      ? "The rules are sealed. Evidence will be read after resolution readiness."
                      : "Resolution is eligible. A funded request starts a candidate hearing; its finalized jury must then be verified."}
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
              {outcome === "REFUNDED"
                ? "Refunded."
                : outcome === "YES"
                  ? "Yes."
                  : outcome === "NO"
                    ? "No."
                    : outcome === "UNRESOLVABLE"
                      ? "Unresolvable."
                      : "Awaiting a hearing."}
            </div>
            <p>
              {outcome === "REFUNDED"
                ? "The funded hearing passed its deadline without a ruling, so every fee and bond went back to the account that paid it. No verdict was adjudicated."
                : outcome === "UNRESOLVABLE"
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
                {!q.archive_reason &&
                (pendingRehearing ||
                  (!latest &&
                    time >=
                      (q.specification.resolution_timestamp ??
                        q.specification.close_timestamp) &&
                    q.escrow?.funded &&
                    (q.can_operate || openToAnyone))) ? (
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
                    {pendingRehearing
                      ? "Retry the funded hearing"
                      : "Request resolution"}
                  </button>
                ) : null}
                {q.can_operate &&
                !q.archived &&
                q.escrow &&
                !q.escrow.funded ? (
                  <button
                    className="button primary"
                    disabled={busy || active || !time}
                    onClick={() => action("fund")}
                  >
                    Fund the resolution fee
                  </button>
                ) : null}
                {waitingWindow ? (
                  <>
                    <p>
                      The verdict is final on GenLayer. Its full challenge
                      window opens next.
                    </p>
                    <button
                      className="button secondary"
                      disabled={busy || active}
                      onClick={() => action("open_round")}
                    >
                      Open the hearing window
                    </button>
                  </>
                ) : null}
                {pendingRehearing ? (
                  <p>
                    The bond is already funded. Retrying this hearing does not
                    charge another bond.
                  </p>
                ) : null}
                {appealOpen && !q.archived ? (
                  <>
                    <p>
                      A different reading deserves a hearing. The next bond is{" "}
                      {nextBond.toString()} GEN wei, sponsored by the relay. You
                      bring the argument. The relay covers the test bond and
                      receives any repayment.
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
                      disabled={
                        busy ||
                        active ||
                        expected === latest?.outcome ||
                        nextBond > maximumSponsoredPayment
                      }
                      onClick={() => action("challenge")}
                    >
                      Request a bonded hearing
                    </button>
                    {nextBond > maximumSponsoredPayment ? (
                      <p>This bond exceeds the Studio sponsorship budget.</p>
                    ) : null}
                    {q.self_funded_challenge ? (
                      <details className="receipt-details">
                        <summary>
                          <Scale size={15} /> Post this bond from your own
                          wallet instead
                        </summary>
                        <p>
                          A sponsored bond costs you nothing, so it cannot deter
                          a repeated dispute. Send this call yourself and the
                          stake, and any repayment, is genuinely yours.
                        </p>
                        <pre>
                          {JSON.stringify(q.self_funded_challenge, null, 2)}
                        </pre>
                      </details>
                    ) : null}
                  </>
                ) : null}
                {latest &&
                !appealOpen &&
                !pendingRehearing &&
                !waitingWindow &&
                deadline > 0 &&
                !q.escrow?.settled ? (
                  <button
                    className="button primary"
                    disabled={busy || active || !time}
                    onClick={() => action("finalize")}
                  >
                    Finalize settlement
                  </button>
                ) : null}
                {q.timeout_claimable ? (
                  <>
                    <p>
                      This funded hearing passed its deadline without a ruling.
                      Anyone can release it, which refunds every fee and bond to
                      the account that paid it.
                    </p>
                    <button
                      className="button primary"
                      disabled={busy || active || !time}
                      onClick={() => action("claim_timeout")}
                    >
                      Release the hearing and refund every payer
                    </button>
                  </>
                ) : null}
                {q.payment?.status === "pending" ? (
                  <>
                    <p>
                      A payment of {q.payment.amount} GEN wei is awaiting your
                      confirmation. Confirming it unblocks your next withdrawal;
                      you do not need the relay to do it.
                    </p>
                    <button
                      className="button secondary"
                      disabled={busy || active || !time}
                      onClick={() => action("confirm_payment")}
                    >
                      Confirm I received this payment
                    </button>
                  </>
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
                {!nativeAppealsEnabled && !q.escrow?.settled && !q.archived ? (
                  <p className="docket-action-note">
                    Studio uses bonded hearings here. Native protocol appeals
                    are paused after a network rollback failed our live check.
                  </p>
                ) : null}
                {nativeAppealOpen ? (
                  <>
                    <button
                      className="button secondary"
                      disabled={
                        busy ||
                        q.operations?.some(
                          (o) =>
                            o.kind === "protocol_appeal" &&
                            [
                              "queued",
                              "submitting",
                              "submitted",
                              "needs_review",
                            ].includes(o.status),
                        )
                      }
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
