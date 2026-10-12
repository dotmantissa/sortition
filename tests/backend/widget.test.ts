import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement, type ComponentType } from "react";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import * as settlement from "../../lib/settlement";
import * as lifecycle from "../../lib/lifecycle";
import * as limits from "../../lib/sponsor-limits";
import type { Question } from "../../lib/types";
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://widget.example",
});
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  navigator: dom.window.navigator,
  HTMLElement: dom.window.HTMLElement,
  IS_REACT_ACT_ENVIRONMENT: true,
}))
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
  });
afterEach(cleanup);
const require = createRequire(import.meta.url);
const finalRecord = {
  question_id: "first",
  outcome: "YES",
  final: true,
  criteria_hash: "a".repeat(64),
  docket_address: "0x" + "b".repeat(40),
  network: "studionet",
  rounds: 2,
};
function load<T>(
  file: string,
  fetcher: typeof fetch,
  overrides: Record<string, unknown> = {},
) {
  const exports: Record<string, unknown> = {};
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports,
    require: (id: string) =>
      id in overrides
        ? overrides[id]
        : id === "../lib/settlement"
          ? settlement
          : require(id),
    fetch: fetcher,
    AbortController,
    AbortSignal,
    setInterval: () => 1,
    clearInterval: () => {},
    console,
    crypto: globalThis.crypto,
    Blob,
    URL,
  });
  return exports as T;
}
test("real React rerenders and changed callbacks do not notify the same final settlement twice", async () => {
  let fetches = 0,
    notifications = 0;
  const { SortitionResolution } = load<{
    SortitionResolution: ComponentType<{
      questionId: string;
      onSettled: () => void;
    }>;
  }>("components/SortitionResolution.tsx", async () => {
    fetches++;
    return Response.json(finalRecord);
  });
  const view = render(
    createElement(SortitionResolution, {
      questionId: "first",
      onSettled: () => {
        notifications++;
      },
    }),
  );
  await waitFor(() => assert.equal(notifications, 1));
  view.rerender(
    createElement(SortitionResolution, {
      questionId: "first",
      onSettled: () => {
        notifications++;
      },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fetches, 1);
  assert.equal(notifications, 1);
});
test("switching questions immediately hides the previous verdict while the new request waits", async () => {
  const { SortitionResolution } = load<{
    SortitionResolution: ComponentType<{ questionId: string }>;
  }>("components/SortitionResolution.tsx", async (url) =>
    String(url).includes("second")
      ? new Promise<Response>(() => {})
      : Response.json(finalRecord),
  );
  const view = render(
    createElement(SortitionResolution, { questionId: "first" }),
  );
  await waitFor(() => assert.ok(view.queryByText("Final verdict: Yes.")));
  view.rerender(createElement(SortitionResolution, { questionId: "second" }));
  assert.equal(view.queryByText("Final verdict: Yes."), null);
  assert.ok(view.queryByText("Reading the public record…"));
});
test("widget rejects inconsistent final PENDING and a mismatched criteria fingerprint", async () => {
  for (const response of [
    { ...finalRecord, outcome: "PENDING" },
    { ...finalRecord, criteria_hash: "c".repeat(64) },
  ]) {
    let notifications = 0;
    const { SortitionResolution } = load<{
      SortitionResolution: ComponentType<{
        questionId: string;
        criteriaHash: string;
        onSettled: () => void;
      }>;
    }>("components/SortitionResolution.tsx", async () =>
      Response.json(response),
    );
    const view = render(
      createElement(SortitionResolution, {
        questionId: "first",
        criteriaHash: finalRecord.criteria_hash,
        onSettled: () => {
          notifications++;
        },
      }),
    );
    await waitFor(() =>
      assert.ok(view.queryByText("The record could not be verified.")),
    );
    assert.equal(notifications, 0);
    view.unmount();
  }
});
test("a nonoperator can retry the failed funded hearing through the actual docket UI", async () => {
  const question: Question = {
    id: "q",
    registry_address: "0xregistry",
    vault_address: "0xvault",
    can_operate: false,
    criteria_hash: "a".repeat(64),
    docket_address: "0x" + "b".repeat(40),
    status: "awaiting_rehearing",
    fee: "0",
    base_bond: "1",
    created_at: new Date().toISOString(),
    specification: {
      question: "Was the final official rate above five percent?",
      criteria: "YES above five percent.",
      unresolvable_definition: "No final official rate.",
      close_timestamp: 0,
      disagreement_rule: "unanimous",
      tie_break_url: "https://a.example",
      sources: [
        { name: "A", url: "https://a.example" },
        { name: "B", url: "https://b.example" },
      ],
    },
    docket: {
      rounds: [
        {
          round: 1,
          outcome: "YES",
          resolved_at: 1,
          deadline: 900,
          sources: [],
        },
      ],
    },
    escrow: {
      version: 2,
      funded: true,
      settled: false,
      challenge_count: 1,
      opened_round: 1,
      round_deadline: 900,
      outcome: "PENDING",
      challenges: [],
    },
    operations: [
      {
        id: "failed",
        kind: "resolve",
        status: "failed",
        tx_hash: "0xfailed",
        error: "Network could not reach a verdict.",
        created_at: new Date().toISOString(),
      },
    ],
    receipts: [],
  };
  const writes: string[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (init?.method === "POST") {
      writes.push(JSON.parse(String(init.body)).action);
      return Response.json({ id: "retry", status: "queued" });
    }
    return Response.json(
      String(url).includes("network") ? { unix: 1000 } : question,
    );
  };
  const auth = {
    authenticated: true,
    login: () => {},
    getAccessToken: async () => "test-auth",
  };
  const { Docket } = load<{ Docket: ComponentType<{ initial: Question }> }>(
    "components/docket.tsx",
    fetcher,
    {
      "@privy-io/react-auth": { usePrivy: () => auth },
      "@/lib/lifecycle": lifecycle,
      "@/lib/sponsor-limits": limits,
      "next/link": {
        default: (props: Record<string, unknown>) => createElement("a", props),
      },
      "./jury-receipt": { JuryReceipt: () => null },
      "./seal": { CriteriaSeal: () => null },
      "./status": { Status: () => null },
    },
  );
  const view = render(createElement(Docket, { initial: question }));
  const button = view.getByRole("button", { name: "Retry the funded hearing" });
  await waitFor(() => assert.equal(button.hasAttribute("disabled"), false));
  assert.equal(
    view.queryByRole("button", { name: "Finalize settlement" }),
    null,
  );
  fireEvent.click(button);
  await waitFor(() => assert.deepEqual(writes, ["resolve"]));
});
