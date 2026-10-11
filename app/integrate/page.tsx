import Link from "next/link";
import { Braces, LockKeyhole, ExternalLink } from "lucide-react";
import { Code } from "@/components/code";
export const metadata = { title: "Integrate your market" };
const register = `const response = await fetch(
  process.env.SORTITION_URL + '/api/questions',
  {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + process.env.SORTITION_API_KEY,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ specification, fee: '0', base_bond: '1' }),
  }
);
if (!response.ok) throw new Error('Registration failed');
const { id } = await response.json();`;
export default function Integrate() {
  return (
    <div className="workspace">
      <div className="page-heading">
        <div className="section-context">
          <Braces size={16} /> For market builders
        </div>
        <h1>
          Your market.
          <br />
          An independent verdict<span>.</span>
        </h1>
        <p>Keep the venue you built. Give its questions a public hearing.</p>
      </div>
      <div className="guide-columns">
        <div>
          <section className="guide-section" id="start">
            <h2>Start with an email.</h2>
            <p>
              Sign in to the operator console and create an API key. Keep it on
              your server. Transactions are submitted by the Sortition relay, so
              your users can get on with their day.
            </p>
            <Link
              className="button primary"
              style={{ marginTop: 20 }}
              href="/console"
            >
              Open the console <LockKeyhole size={15} />
            </Link>
          </section>
          <section className="guide-section" id="register">
            <h2>Agree on the evidence.</h2>
            <p>
              A specification contains the question, written criteria, two to
              five named HTTPS sources, a disagreement rule, a named tie source
              from that set, a closing timestamp, and an explicit definition of
              unresolvable. The entire specification is hashed and locked.
            </p>
            <Code>{register}</Code>
            <p>
              Registration returns a question ID and operation ID. Poll the
              docket endpoint until the address and criteria fingerprint appear.
              A closing time in the future is required.
            </p>
          </section>
          <section className="guide-section" id="verdict">
            <h2>Wait for the final word.</h2>
            <p>
              After the close, request resolution. A consensus verdict opens the
              bonded challenge window. Finalize once it expires. Your venue
              should consume only a settlement with <code>final: true</code>.
            </p>
            <Code>{`const response = await fetch(
  process.env.SORTITION_URL + '/api/questions/' + questionId + '/settlement'
);
const settlement = await response.json();
if (settlement.final) {
  // Apply your venue's payout or refund policy.
  // UNRESOLVABLE is an outcome, not an exception.
  await yourVenue.settle(settlement);
}`}</Code>
            <p>
              An API response is an integration convenience. An external chain
              needs a verified bridge or its own oracle to authenticate the
              GenLayer state before moving funds.
            </p>
          </section>
          <section className="guide-section" id="widget">
            <h2>Put the record beside the market.</h2>
            <p>
              The React widget reads the final settlement and links to its
              docket. It needs no user wallet and no API key.
            </p>
            <Code>{`import { SortitionResolution } from './SortitionResolution';

<SortitionResolution
  questionId={questionId}
  baseUrl={process.env.NEXT_PUBLIC_SORTITION_URL}
  onSettled={handleFinalSettlement}
/>`}</Code>
            <p>
              Copy the component from the repository into your React project.
              The settlement endpoint supports public reads across origins.
            </p>
          </section>
          <section className="guide-section" id="api">
            <h2>A small, practical API.</h2>
            <table className="endpoint-table">
              <thead>
                <tr>
                  <th>Method</th>
                  <th>Endpoint</th>
                  <th>Purpose</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["POST", "/api/questions", "Register locked criteria"],
                  ["GET", "/api/questions/:id", "Read docket and receipts"],
                  [
                    "POST",
                    "/api/questions/:id/actions",
                    "Fund, resolve, challenge, or finalize",
                  ],
                  [
                    "GET",
                    "/api/questions/:id/settlement",
                    "Read final outcome",
                  ],
                  ["POST", "/api/rpc", "JSON RPC 2.0 interface"],
                ].map(([m, p, d]) => (
                  <tr key={p + m}>
                    <td>{m}</td>
                    <td>
                      <code>{p}</code>
                    </td>
                    <td>{d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Writes require an API key and an idempotency key. Docket reads are
              public. The JSON RPC methods are documented in the repository.
            </p>
          </section>
          <section className="guide-section" id="webhooks">
            <h2>The verdict can come to you.</h2>
            <p>
              Attach a public HTTPS webhook URL and a signing secret of at least
              24 characters when you register. Final settlements are delivered
              with an event ID and a timestamped HMAC signature. Failed
              deliveries retry with increasing delays.
            </p>
            <p>
              Verify the signature, reject stale timestamps, and store the event
              ID before applying a settlement. Webhook secrets are encrypted at
              rest.
            </p>
          </section>
          <section className="guide-section" id="polymarket">
            <h2>A real market to start from.</h2>
            <p>
              The console imports question text, criteria, closing time, and the
              named resolution source from Polymarket’s public Gamma API. Add
              the remaining authoritative sources and review every rule before
              registering.
            </p>
            <p>
              Importing does not change Polymarket’s settlement system. The
              reference adapter registers a separate Sortition docket for a real
              venue question and consumes its result in your own integration.
            </p>
            <a
              className="quiet-link"
              style={{ marginTop: 18 }}
              href="https://github.com/dotmantissa/sortition/tree/main/integrations"
              target="_blank"
              rel="noreferrer"
            >
              Read the reference integration <ExternalLink size={14} />
            </a>
          </section>
        </div>
        <aside className="guide-rail">
          <h3>Integration notes</h3>
          {[
            ["start", "Email and API access"],
            ["register", "Lock the specification"],
            ["verdict", "Consume settlement"],
            ["widget", "Embed the record"],
            ["api", "REST and JSON RPC"],
            ["webhooks", "Signed webhooks"],
            ["polymarket", "Polymarket reference"],
          ].map(([id, label]) => (
            <a href={`#${id}`} key={id}>
              {label}
            </a>
          ))}
          <p>
            Sortition resolves questions. Your venue keeps its own positions,
            liquidity, and payout policy.
          </p>
          <p>
            Studio is a development network. Fees and bonds use test GEN
            sponsored by the relay.
          </p>
        </aside>
      </div>
    </div>
  );
}
