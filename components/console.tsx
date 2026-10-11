"use client";
import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  LockKeyhole,
  Plus,
  Trash2,
  Check,
  Mail,
  LoaderCircle,
  FileText,
  ExternalLink,
  ChevronDown,
  KeyRound,
  Copy,
  CircleAlert,
} from "lucide-react";
import { CriteriaSeal } from "./seal";
import { Status } from "./status";
import type { Question, Source, Specification } from "@/lib/types";
import { registrationSchema } from "@/lib/validation";
export function OperatorConsole() {
  const [interactive, setInteractive] = useState(false);
  const { authenticated, ready, login, getAccessToken } = usePrivy();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(false);
  const [draft, setDraft] = useState({
    question: "",
    criteria: "",
    unresolvable_definition: "",
    close: "",
    disagreement_rule: "unanimous",
    tie: 0,
    fee: "0",
    base_bond: "1",
    webhook_url: "",
    webhook_secret: "",
  });
  const [sources, setSources] = useState<Source[]>([
    { name: "", url: "" },
    { name: "", url: "" },
  ]);
  const [apiKey, setApiKey] = useState("");
  const [keys, setKeys] = useState<{ id: string; prefix: string }[]>([]);
  const [copied, setCopied] = useState(false);
  const [importSlug, setImportSlug] = useState("");
  const [venue, setVenue] = useState<Specification["venue"]>();
  const [importBusy, setImportBusy] = useState(false);
  const [importNotice, setImportNotice] = useState("");
  const [clock, setClock] = useState<{
    unix: number;
    offset_seconds: number;
  } | null>(null);
  useEffect(() => {
    setInteractive(true);
    fetch("/api/network")
      .then((r) => (r.ok ? r.json() : null))
      .then(setClock)
      .catch(() => setClock(null));
  }, []);
  const authFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const token = await getAccessToken();
      return fetch(url, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${token}` },
      });
    },
    [getAccessToken],
  );
  const refresh = useCallback(async () => {
    if (!authenticated) return;
    try {
      const r = await authFetch("/api/questions?mine=true");
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      setQuestions(data.questions);
      const k = await authFetch("/api/keys");
      if (k.ok) setKeys((await k.json()).keys);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The console could not refresh.",
      );
    }
  }, [authenticated, authFetch]);
  useEffect(() => {
    refresh();
    if (!authenticated) return;
    const t = setInterval(refresh, 15000);
    return () => clearInterval(t);
  }, [refresh, authenticated]);
  function update(name: string, value: string | number) {
    setDraft((d) => ({ ...d, [name]: value }));
    setReview(false);
  }
  function body() {
    return {
      specification: {
        question: draft.question,
        criteria: draft.criteria,
        unresolvable_definition: draft.unresolvable_definition,
        sources,
        tie_break_url: sources[draft.tie]?.url,
        disagreement_rule: draft.disagreement_rule,
        close_timestamp: Math.floor(new Date(draft.close).getTime() / 1000),
        ...(venue ? { venue } : {}),
      },
      fee: draft.fee,
      base_bond: draft.base_bond,
      ...(draft.webhook_url
        ? { webhook: { url: draft.webhook_url, secret: draft.webhook_secret } }
        : {}),
    };
  }
  function validate() {
    const p = registrationSchema.safeParse(body());
    if (!p.success) {
      setError(p.error.issues[0].message);
      return false;
    }
    if (
      p.data.specification.close_timestamp <=
      Date.now() / 1000 + (clock?.offset_seconds || 0) + 60
    ) {
      setError(
        "Choose a closing time at least a minute after the network time.",
      );
      return false;
    }
    setError("");
    return true;
  }
  async function submit() {
    if (!authenticated) {
      login();
      return;
    }
    if (!validate()) return;
    setBusy(true);
    try {
      const r = await authFetch("/api/questions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body()),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      window.location.href = `/dockets/${data.id}`;
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Registration could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createKey() {
    setBusy(true);
    setError("");
    try {
      const r = await authFetch("/api/keys", { method: "POST" });
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setApiKey(d.key);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create a key.");
    } finally {
      setBusy(false);
    }
  }
  async function revokeKey(id: string) {
    const r = await authFetch("/api/keys", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (!r.ok) setError("Could not revoke that key. Please try again.");
    else {
      setApiKey("");
      await refresh();
    }
  }
  async function importMarket() {
    setImportBusy(true);
    setError("");
    try {
      const r = await fetch(
        `/api/integrations/polymarket?slug=${encodeURIComponent(importSlug)}`,
      );
      const d = await r.json();
      if (!r.ok) throw Error(d.error);
      setDraft((x) => ({
        ...x,
        question: d.question,
        criteria: d.description,
        close: d.end_date
          ? new Date(
              new Date(d.end_date).getTime() -
                new Date(d.end_date).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)
          : x.close,
      }));
      setVenue({ name: "Polymarket", market_id: d.id, url: d.url });
      if (d.resolution_source?.startsWith("https://"))
        setSources([
          { name: "Registered venue source", url: d.resolution_source },
          { name: "", url: "" },
        ]);
      setImportNotice(
        "Market imported. Review the criteria and add the remaining sources before locking it.",
      );
      setReview(false);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "We could not find that market.",
      );
    } finally {
      setImportBusy(false);
    }
  }
  return (
    <div className="workspace">
      <div className="page-heading">
        <div className="section-context">
          <FileText size={16} /> Operator console
        </div>
        <h1>
          Set the rules.
          <br />
          Then let them stand<span>.</span>
        </h1>
        <p>A little care here saves a very long argument later.</p>
      </div>
      {!authenticated ? (
        <div className="email-gate">
          <Mail size={27} strokeWidth={1.4} />
          <div>
            <h2>Your email is your way in.</h2>
            <p>
              Sign in to register questions, follow resolutions, and connect
              your market. We handle the transactions.
            </p>
          </div>
          <button
            className="button primary"
            onClick={() => login()}
            disabled={!ready}
          >
            Continue with email
          </button>
        </div>
      ) : null}
      <div className="console-columns">
        <div className="registration">
          <div className="panel-heading">
            <h2>{review ? "One last look." : "Register a question"}</h2>
            <LockKeyhole size={20} />
          </div>
          {error ? (
            <div className="alert error" role="alert">
              <CircleAlert size={17} />
              {error}
            </div>
          ) : null}
          {review ? (
            <div className="review-panel">
              <CriteriaSeal />
              <h3>{draft.question}</h3>
              <p>{draft.criteria}</p>
              <dl>
                <dt>When sources disagree</dt>
                <dd>
                  {draft.disagreement_rule === "unanimous"
                    ? "Every source must agree"
                    : draft.disagreement_rule === "majority"
                      ? "More than half of all registered sources must agree"
                      : "The named tie source decides a disagreement"}
                </dd>
                <dt>Unresolvable when</dt>
                <dd>{draft.unresolvable_definition}</dd>
                <dt>Question closes</dt>
                <dd>{new Date(draft.close).toLocaleString()} local time</dd>
                <dt>Resolution fee</dt>
                <dd>{draft.fee} GEN wei, sponsored by the operator relay</dd>
                <dt>First appeal bond</dt>
                <dd>{draft.base_bond} GEN wei. Doubles each round.</dd>
              </dl>
              <div className="review-sources">
                {sources.map((s, i) => (
                  <div key={i}>
                    <LockKeyhole size={15} />
                    <span>
                      <strong>{s.name}</strong>
                      <small>{s.url}</small>
                    </span>
                    {draft.tie === i ? (
                      <span className="tie-tag">Tie source</span>
                    ) : null}
                  </div>
                ))}
              </div>
              <p className="fine-print">
                Once registered, the question, source set, and criteria cannot
                be edited. Read it like you’re the person who loses.
              </p>
              <div className="form-actions">
                <button
                  className="button secondary"
                  onClick={() => setReview(false)}
                >
                  Keep editing
                </button>
                <button
                  className="button primary"
                  disabled={busy || !authenticated}
                  onClick={submit}
                >
                  {busy ? (
                    <LoaderCircle className="spinning" size={16} />
                  ) : (
                    <LockKeyhole size={16} />
                  )}
                  Lock and register
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (validate()) setReview(true);
              }}
            >
              <fieldset className="registration-fields" disabled={!interactive}>
                <details className="import-market">
                  <summary>
                    <ExternalLink size={15} /> Start from a Polymarket question{" "}
                    <ChevronDown size={15} />
                  </summary>
                  <p>
                    Bring in a real market. You’ll still choose and lock the
                    evidence rules.
                  </p>
                  <div className="inline-input">
                    <input
                      aria-label="Polymarket market slug"
                      placeholder="Paste a market URL or slug"
                      value={importSlug}
                      onChange={(e) => setImportSlug(e.target.value)}
                    />
                    <button
                      className="button secondary"
                      type="button"
                      disabled={!importSlug || importBusy}
                      onClick={importMarket}
                    >
                      {importBusy ? "Finding…" : "Import"}
                    </button>
                  </div>
                  {importNotice ? (
                    <p className="success-note" role="status">
                      {importNotice}
                    </p>
                  ) : null}
                </details>
                <label>
                  What’s the question?
                  <textarea
                    required
                    minLength={10}
                    maxLength={1000}
                    rows={2}
                    value={draft.question}
                    onChange={(e) => update("question", e.target.value)}
                    placeholder="Write a question with a clear yes or no answer."
                  />
                </label>
                <label>
                  What counts as yes? What counts as no?
                  <textarea
                    required
                    minLength={10}
                    maxLength={10000}
                    rows={4}
                    value={draft.criteria}
                    onChange={(e) => update("criteria", e.target.value)}
                    placeholder="Be specific about dates, thresholds, and a final result. Name the factual value to extract, with a consistent format such as winner=france."
                  />
                  <span className="field-help">
                    If a reasonable person could read it two ways, give them one
                    more sentence.
                  </span>
                </label>
                <label>
                  When does the question close?
                  <input
                    type="datetime-local"
                    required
                    value={draft.close}
                    onChange={(e) => update("close", e.target.value)}
                  />
                  <span className="field-help">
                    Your local time. Resolution starts after this moment.
                    {clock
                      ? ` Network time is ${new Date(clock.unix * 1000).toLocaleString()}.`
                      : " Checking the network clock…"}
                  </span>
                </label>
                <fieldset className="sources-fieldset">
                  <legend>The evidence everyone agrees to use</legend>
                  <p className="field-help">
                    Two to five named sources. They all get read independently.
                  </p>
                  {sources.map((s, i) => (
                    <div className="source-input" key={i}>
                      <div className="source-lock">
                        <LockKeyhole size={16} />
                      </div>
                      <div className="source-fields">
                        <input
                          aria-label={`Source ${i + 1} name`}
                          required
                          placeholder="Source name"
                          value={s.name}
                          maxLength={120}
                          onChange={(e) => {
                            setSources((a) =>
                              a.map((x, j) =>
                                j === i ? { ...x, name: e.target.value } : x,
                              ),
                            );
                            setReview(false);
                          }}
                        />
                        <input
                          aria-label={`Source ${i + 1} URL`}
                          type="url"
                          required
                          placeholder="https://"
                          value={s.url}
                          onChange={(e) => {
                            setSources((a) =>
                              a.map((x, j) =>
                                j === i ? { ...x, url: e.target.value } : x,
                              ),
                            );
                            setReview(false);
                          }}
                        />
                      </div>
                      {sources.length > 2 ? (
                        <button
                          className="icon-button"
                          type="button"
                          aria-label={`Remove source ${i + 1}`}
                          onClick={() => {
                            setSources((a) => a.filter((_, j) => j !== i));
                            update("tie", 0);
                          }}
                        >
                          <Trash2 size={15} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                  <button
                    className="add-source"
                    type="button"
                    disabled={sources.length >= 5}
                    onClick={() =>
                      setSources((s) => [...s, { name: "", url: "" }])
                    }
                  >
                    <Plus size={16} />
                    Add another source
                  </button>
                </fieldset>
                <div className="form-pair">
                  <label>
                    When sources disagree
                    <select
                      value={draft.disagreement_rule}
                      onChange={(e) =>
                        update("disagreement_rule", e.target.value)
                      }
                    >
                      <option value="unanimous">Every source must agree</option>
                      <option value="majority">A majority must agree</option>
                      <option value="tie_break">Use the tie source</option>
                    </select>
                  </label>
                  <label>
                    The named tie source
                    <select
                      value={draft.tie}
                      onChange={(e) => update("tie", Number(e.target.value))}
                    >
                      {sources.map((s, i) => (
                        <option key={i} value={i}>
                          {s.name || `Source ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label>
                  When should we say “unresolvable”?
                  <textarea
                    required
                    minLength={10}
                    rows={3}
                    maxLength={10000}
                    value={draft.unresolvable_definition}
                    onChange={(e) =>
                      update("unresolvable_definition", e.target.value)
                    }
                    placeholder="Missing results? A cancelled event? Conflicting official reports? Name the uncertainty you won’t pretend away."
                  />
                </label>
                <details className="advanced">
                  <summary>
                    Fee, appeal bond, and webhook <ChevronDown size={16} />
                  </summary>
                  <p className="field-help">
                    Studio uses test GEN. Fees and bonds are paid by the server
                    relay. A funded relay is required for amounts above zero.
                  </p>
                  <div className="form-pair">
                    <label>
                      Resolution fee in GEN wei
                      <input
                        inputMode="numeric"
                        pattern="[0-9]+"
                        value={draft.fee}
                        onChange={(e) => update("fee", e.target.value)}
                      />
                    </label>
                    <label>
                      First appeal bond in GEN wei
                      <input
                        inputMode="numeric"
                        pattern="[1-9][0-9]*"
                        value={draft.base_bond}
                        onChange={(e) => update("base_bond", e.target.value)}
                      />
                    </label>
                  </div>
                  <label>
                    Webhook URL, optional
                    <input
                      type="url"
                      placeholder="https://your.market/settlement"
                      value={draft.webhook_url}
                      onChange={(e) => update("webhook_url", e.target.value)}
                    />
                  </label>
                  <label>
                    Webhook signing secret
                    <input
                      type="password"
                      autoComplete="new-password"
                      value={draft.webhook_secret}
                      onChange={(e) => update("webhook_secret", e.target.value)}
                      placeholder="At least 24 characters"
                    />
                  </label>
                </details>
                <div className="form-actions">
                  <p>
                    <LockKeyhole size={14} />
                    Review before anything is locked.
                  </p>
                  <button className="button primary" type="submit">
                    Review question <Check size={16} />
                  </button>
                </div>
              </fieldset>
            </form>
          )}
        </div>
        <aside className="operator-rail">
          <section className="rail-note">
            <CriteriaSeal />
            <h3>The rules are the product.</h3>
            <p>
              You keep the market. We handle the hearing. No positions, no
              liquidity pool, no thumb on the scale.
            </p>
            <p>
              Every source is locked before the question closes. A verdict can
              only use what was registered.
            </p>
          </section>
          <section className="operator-questions">
            <h3>
              Your questions <span className="count">{questions.length}</span>
            </h3>
            {questions.length ? (
              questions.map((q) => (
                <Link key={q.id} href={`/dockets/${q.id}`}>
                  <strong>{q.specification.question}</strong>
                  <Status
                    value={q.docket?.rounds.at(-1)?.outcome || q.status}
                  />
                </Link>
              ))
            ) : (
              <p>
                {authenticated
                  ? "Your first question will live here."
                  : "Sign in to see your questions."}
              </p>
            )}
          </section>
          {authenticated ? (
            <section className="api-key-panel">
              <h3>
                <KeyRound size={17} /> Integrate your market
              </h3>
              <p>
                Create an API key for your server. Keep it somewhere private.
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={createKey}
              >
                Create API key
              </button>
              {apiKey ? (
                <div className="secret-reveal">
                  <p>This key is shown once. Copy it now.</p>
                  <code>{apiKey}</code>
                  <button
                    className="icon-button"
                    aria-label="Copy API key"
                    onClick={async () => {
                      await navigator.clipboard.writeText(apiKey);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
              ) : null}
              {keys.map((k) => (
                <div className="key-row" key={k.id}>
                  <code>{k.prefix}…</code>
                  <button onClick={() => revokeKey(k.id)}>Revoke</button>
                </div>
              ))}
              <Link href="/integrate" className="quiet-link">
                Read the guide <ExternalLink size={13} />
              </Link>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
