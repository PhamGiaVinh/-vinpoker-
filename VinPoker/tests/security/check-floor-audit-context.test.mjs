import assert from "node:assert/strict";
import test from "node:test";

import { validateFloorAuditContext } from "../../scripts/security/check-floor-audit-context.mjs";

const previewContext = {
  FLOOR_UAT_ENV: "preview",
  FLOOR_UAT_SUPABASE_URL: "https://previewfloorref123.supabase.co",
  FLOOR_UAT_PROJECT_REF: "previewfloorref123",
  FLOOR_UAT_PRODUCTION_PROJECT_REF: "productionfloorref",
  FLOOR_UAT_BASE_URL: "https://audit-preview.example.test",
  FLOOR_UAT_PRODUCTION_DOMAIN: "vinpoker.example.test",
  FLOOR_UAT_FIXTURE_PREFIX: "CODEX_FLOOR_UAT_run_",
  GITHUB_REF: "refs/heads/codex/floor-production-readiness-v3",
};

test("allows an explicitly identified non-production preview audit", () => {
  assert.deepEqual(validateFloorAuditContext(previewContext), []);
});

test("fails closed for production, main, or an unowned fixture prefix", () => {
  const failures = validateFloorAuditContext({
    ...previewContext,
    FLOOR_UAT_PROJECT_REF: previewContext.FLOOR_UAT_PRODUCTION_PROJECT_REF,
    FLOOR_UAT_SUPABASE_URL: "https://productionfloorref.supabase.co",
    FLOOR_UAT_BASE_URL: "https://vinpoker.example.test",
    FLOOR_UAT_FIXTURE_PREFIX: "TOURNAMENT_",
    GITHUB_REF: "refs/heads/main",
  });

  assert.deepEqual(failures, [
    "GITHUB_REF must not be refs/heads/main",
    "FLOOR_UAT_FIXTURE_PREFIX must start with CODEX_FLOOR_UAT_",
    "FLOOR_UAT_PROJECT_REF must not match the production project",
    "FLOOR_UAT_SUPABASE_URL must not point at the production project",
    "FLOOR_UAT_BASE_URL must not use the production domain",
  ]);
});
