"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="not-found">
      <h1>The record is taking a moment.</h1>
      <p>We couldn’t load this page. Give it another try.</p>
      <button className="button primary" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
