import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(
  new URL(
    "../../../.github/workflows/floor-frontend-one-shot.yml",
    import.meta.url,
  ),
  "utf8",
);

test("one-shot Floor frontend rollout is immutable and protected", () => {
  assert.match(
    workflow,
    /PRODUCTION_SOURCE_SHA: ca95d444329b39efb74913d3bfd37150364fcd96/u,
  );
  assert.match(
    workflow,
    /EXPECTED_PRODUCTION_DEPLOYMENT_SHA: cdb67da6e4f77caa9e3277cea0fe6994f9d41cb6/u,
  );
  assert.match(
    workflow,
    /TARGET_SHA: ad3e8796240ce5a71f860a8d4272dc525489fc37/u,
  );
  assert.match(
    workflow,
    /REVIEWED_MERGE_SHA: b26afe54c720124ef7d85b7e98c5f36e89d1d936/u,
  );
  assert.match(workflow, /environment: dealer-swing-production-critical/u);
  assert.match(workflow, /FRONTEND_RECEIPT_ENVIRONMENT: receipt-vinpoker-frontend/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /required_reviewers/u);
  assert.match(
    workflow,
    /DEPLOY_REVIEWED_FLOOR_TABLE_DEEPLINK_FRONTEND/u,
  );
  assert.match(
    workflow,
    /git merge-base --is-ancestor "\$TARGET_SHA" "\$REVIEWED_MERGE_SHA"/u,
  );
  assert.match(
    workflow,
    /git diff --quiet "\$TARGET_SHA" "\$REVIEWED_MERGE_SHA"/u,
  );
  assert.equal(
    workflow.match(/deployment-receipts\.mjs fetch/gu)?.length,
    2,
  );
  assert.equal(
    workflow.match(/receipt\.frontend\?\.sha !== process\.env\.PRODUCTION_SOURCE_SHA/gu)?.length,
    2,
  );
  assert.equal(
    workflow.match(/receipt\.frontend\?\.deploymentId/gu)?.length,
    2,
  );
});

test("one-shot Floor frontend rollout cannot mutate DB, Edge, flags or payment paths", () => {
  assert.doesNotMatch(
    workflow,
    /supabase\s+db\s+(push|reset)|supabase\s+migration\s+up/iu,
  );
  assert.doesNotMatch(workflow, /supabase\s+functions\s+deploy/iu);
  assert.doesNotMatch(workflow, /floorAtomicPayout\s*=\s*true/iu);
  assert.doesNotMatch(workflow, /trackerChipQuickEdit\s*=\s*true/iu);
  assert.doesNotMatch(workflow, /sepay|staking|bank[_ -]?transfer/iu);
  assert.doesNotMatch(workflow, /--token\b/iu);
  assert.doesNotMatch(workflow, /vercel pull/iu);
  assert.doesNotMatch(workflow, /vercel env run --environment=production/u);
  assert.match(
    workflow,
    /VITE_SUPABASE_URL: https:\/\/\$\{\{ secrets\.SUPABASE_PROJECT_REF \}\}\.supabase\.co/u,
  );
  assert.match(
    workflow,
    /VITE_SUPABASE_PUBLISHABLE_KEY: \$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/u,
  );
  assert.match(workflow, /trap 'rm -f \.vercel\/project\.json' EXIT/u);
  assert.match(workflow, /"Cache-Control":"no-cache, must-revalidate"/u);
  assert.match(workflow, /git diff --quiet "\$TARGET_SHA" origin\/main/u);
  assert.match(workflow, /cmp --silent VinPoker\/dist\/version\.json/u);
  assert.match(
    workflow,
    /tr -d '\\r'[\s\S]*grep -iqx 'cache-control:\[\[:space:\]\]\*no-cache, must-revalidate'/u,
  );
  assert.match(workflow, /--component frontend/u);
});

test("frontend source allowlist remains exactly the three reviewed Floor table deep-link files", () => {
  const allowlist = [
    "VinPoker/src/pages/ops/OpsTables.tsx",
    "VinPoker/src/pages/ops/opsTablesTournamentSelection.test.ts",
    "VinPoker/src/pages/ops/opsTablesTournamentSelection.ts",
  ];
  for (const path of allowlist)
    assert.match(workflow, new RegExp(path.replaceAll("/", "\\/"), "u"));
  assert.doesNotMatch(workflow, /deploy_checkout_dealer|checkout-dealer/u);
});
