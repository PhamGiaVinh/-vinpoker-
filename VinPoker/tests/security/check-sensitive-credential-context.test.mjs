import assert from "node:assert/strict";
import test from "node:test";

import { findUnsafeVariableReferences } from "../../scripts/security/check-sensitive-credential-context.mjs";

test("allows GitHub Actions secrets context for protected credentials", () => {
  const findings = findUnsafeVariableReferences("token: ${{ secrets.VERCELTOKEN }}");

  assert.deepEqual(findings, []);
});

test("rejects dot and bracket vars context for protected credentials", () => {
  const findings = findUnsafeVariableReferences([
    "token: ${{ vars.SUPABASEACCESTOKEN }}",
    "backup: ${{ vars['VBACKER1'] }}",
  ].join("\n"));

  assert.deepEqual(findings, [
    { credentialName: "SUPABASEACCESTOKEN", line: 1 },
    { credentialName: "VBACKER1", line: 2 },
  ]);
});
