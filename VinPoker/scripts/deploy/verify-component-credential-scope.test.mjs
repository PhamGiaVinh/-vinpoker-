import assert from "node:assert/strict";
import test from "node:test";

import {
  credentialScope,
  missingScopedCredentials,
  requiredCredentialNames,
} from "./verify-component-credential-scope.mjs";

test("Edge-only deployment keeps Vercel out of scope", () => {
  const scope = credentialScope({ selectedFunctions: ["process-swing"], deployFrontend: false });
  assert.deepEqual(scope, {
    GitHub: "IN_SCOPE",
    Supabase: "IN_SCOPE",
    Vercel: "NOT_IN_SCOPE",
    frontendDeploy: false,
  });
  assert.equal(requiredCredentialNames(scope).includes("VERCEL_TOKEN"), false);
  assert.deepEqual(missingScopedCredentials(scope, {
    GITHUB_TOKEN: "set",
    SUPABASE_ACCESS_TOKEN: "set",
    SUPABASE_DB_PASSWORD: "set",
    SUPABASE_PROJECT_REF: "set",
  }), []);
});

test("frontend deployment fails closed when the Vercel credential is absent", () => {
  const scope = credentialScope({ selectedFunctions: [], deployFrontend: true });
  assert.equal(scope.Vercel, "IN_SCOPE");
  assert.deepEqual(missingScopedCredentials(scope, {
    GITHUB_TOKEN: "set",
    SUPABASE_ACCESS_TOKEN: "set",
    SUPABASE_DB_PASSWORD: "set",
    SUPABASE_PROJECT_REF: "set",
    VITE_SUPABASE_PUBLISHABLE_KEY: "set",
  }), ["VERCEL_TOKEN"]);
});

test("an empty plan has no credential scope and never returns values", () => {
  const scope = credentialScope({ selectedFunctions: [], deployFrontend: false });
  assert.deepEqual(scope, {
    GitHub: "NOT_IN_SCOPE",
    Supabase: "NOT_IN_SCOPE",
    Vercel: "NOT_IN_SCOPE",
    frontendDeploy: false,
  });
  assert.deepEqual(requiredCredentialNames(scope), []);
});
