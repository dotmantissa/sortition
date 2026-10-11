"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Search,
  LockKeyhole,
  FolderOpen,
  SlidersHorizontal,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { Status } from "./status";
import type { Question } from "@/lib/types";
export function Explorer({
  initial,
  unavailable,
}: {
  initial: Question[];
  unavailable: boolean;
}) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState(initial);
  const [error, setError] = useState(unavailable);
  const [busy, setBusy] = useState(false);
  const filtered = useMemo(
    () =>
      rows.filter(
        (q) =>
          (filter === "all" ||
            (filter === "settled" ? q.escrow?.settled : !q.escrow?.settled)) &&
          `${q.specification.question} ${q.specification.venue?.name || ""}`
            .toLowerCase()
            .includes(search.toLowerCase()),
      ),
    [rows, filter, search],
  );
  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/questions");
      if (!r.ok) throw Error();
      setRows((await r.json()).questions);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  const resolved = rows.filter((q) => q.escrow?.settled).length;
  return (
    <section className="explorer">
      <div className="section-heading">
        <div>
          <div className="section-context">
            <FolderOpen size={16} /> Public record
          </div>
          <h2>
            The docket<span className="count">{rows.length}</span>
          </h2>
          <p>Questions, evidence, and the reasoning that settles them.</p>
        </div>
        <div className="record-stat">
          <span>{resolved}</span>
          <p>
            settled questions
            <br />
            in the public record
          </p>
        </div>
      </div>
      <div className="explorer-toolbar">
        <div className="filter-tabs" aria-label="Filter questions">
          {[
            ["all", "All questions"],
            ["open", "In progress"],
            ["settled", "Settled"],
          ].map(([v, l]) => (
            <button
              key={v}
              className={filter === v ? "selected" : ""}
              onClick={() => setFilter(v)}
            >
              {l}
            </button>
          ))}
        </div>
        <label className="search-field">
          <Search size={17} />
          <input
            aria-label="Search questions"
            placeholder="Find a question"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button
          onClick={refresh}
          className="icon-button"
          aria-label="Refresh docket"
          disabled={busy}
        >
          <RefreshCw size={17} className={busy ? "spinning" : ""} />
        </button>
      </div>
      {error ? (
        <div className="empty-record">
          <SlidersHorizontal size={28} />
          <h3>The record is taking a moment.</h3>
          <p>We couldn’t reach the docket. Try refreshing in a little while.</p>
          <button className="button secondary" onClick={refresh}>
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-record">
          <div className="empty-lock">
            <LockKeyhole size={28} strokeWidth={1.3} />
          </div>
          <h3>
            {search
              ? "No questions match that search."
              : rows.length
                ? "Nothing in this view yet."
                : "The first question starts the record."}
          </h3>
          <p>
            {search
              ? "Try a different word or clear the search."
              : "Register a question, agree on its sources, and give the verdict somewhere to live."}
          </p>
          <Link href="/console" className="button secondary">
            Open the operator console
          </Link>
        </div>
      ) : (
        <div className="docket-table">
          <div className="table-head">
            <span>Question & sources</span>
            <span>Closing time</span>
            <span>Verdict</span>
          </div>
          {filtered.map((q) => {
            const latest = q.docket?.rounds.at(-1);
            return (
              <Link className="docket-row" key={q.id} href={`/dockets/${q.id}`}>
                <div className="row-question">
                  <span className="row-venue">
                    {q.specification.venue?.name || "Independent market"}
                  </span>
                  <h3>{q.specification.question}</h3>
                  <p>
                    <LockKeyhole size={13} />
                    {q.specification.sources.length} registered sources{" "}
                    <span className="hash-preview">
                      {q.criteria_hash?.slice(0, 10)}
                    </span>
                  </p>
                </div>
                <time
                  dateTime={new Date(
                    q.specification.close_timestamp * 1000,
                  ).toISOString()}
                >
                  {new Date(
                    q.specification.close_timestamp * 1000,
                  ).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                  <small>UTC</small>
                </time>
                <div className="row-verdict">
                  <Status value={latest?.outcome || q.status} />
                  <ExternalLink size={16} />
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <div className="record-footnote">
        <LockKeyhole size={13} />
        <span>
          The source set stays locked. Even when the answer is inconvenient.
        </span>
      </div>
    </section>
  );
}
