import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

test("payment reconciliation identity includes its vault across immutable deployments", () => {
  const rows = [{ id: "old-payment", vault: "old-vault" }];
  const sql = (_parts: TemplateStringsArray, ...values: unknown[]) => {
    const vault = values[2];
    return rows.filter((row) => vault === null || row.vault === vault);
  };
  const exports: {
    activePaymentOperation?: (
      beneficiary: string,
      id: string,
      vault: string,
    ) => typeof rows;
  } = {};
  const compiled = ts.transpileModule(readFileSync("lib/payments.ts", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { exports, require: () => ({ db: () => sql }) });
  assert.equal(
    exports.activePaymentOperation!("beneficiary", "1", "old-vault").length,
    1,
  );
  assert.equal(
    exports.activePaymentOperation!("beneficiary", "1", "new-vault").length,
    0,
  );
});
