import assert from "node:assert/strict";
import test from "node:test";

import {
  findHardcodedCredentialLikeLiterals,
  findUnsafeVariableReferences,
} from "../../scripts/security/check-sensitive-credential-context.mjs";

test("allows GitHub Actions secrets context for protected credentials", () => {
  const findings = findUnsafeVariableReferences([
    "token: ${{ secrets.VERCEL_TOKEN }}",
    "legacy-token: ${{ secrets.VERCELTOKEN }}",
    "supabase: ${{ secrets.SUPABASE_ACCESS_TOKEN }}",
  ].join("\n"));

  assert.deepEqual(findings, []);
});

test("rejects dot and bracket vars context for protected credentials", () => {
  const findings = findUnsafeVariableReferences([
    "token: ${{ vars.SUPABASEACCESTOKEN }}",
    "legacy-token: ${{ vars.SUPABASEACCESSTOKEN }}",
    "canonical-token: ${{ vars['SUPABASE_ACCESS_TOKEN'] }}",
    "backup: ${{ vars['VBACKER1'] }}",
  ].join("\n"));

  assert.deepEqual(findings, [
    { credentialName: "SUPABASEACCESTOKEN", line: 1 },
    { credentialName: "SUPABASEACCESSTOKEN", line: 2 },
    { credentialName: "SUPABASE_ACCESS_TOKEN", line: 3 },
    { credentialName: "VBACKER1", line: 4 },
  ]);
});

test("rejects hardcoded publishable-key-like workflow material without exposing its value", () => {
  const jwtLike = ["eyJhbGciOiJIUzI1NiJ9", "test", "signature"].join(".");
  const findings = findHardcodedCredentialLikeLiterals(
    `VITE_SUPABASE_PUBLISHABLE_KEY: "${jwtLike}"`,
  );

  assert.deepEqual(findings, [
    { credentialName: "SUPABASE_PUBLISHABLE_KEY", line: 1 },
  ]);
});

test("does not flag ordinary VBacker product text or canonical secret references", () => {
  assert.deepEqual(findUnsafeVariableReferences("label: VBacker\ntext: VBACKER1"), []);
  assert.deepEqual(findHardcodedCredentialLikeLiterals("name: VBacker\nvalue: public product text"), []);
});
