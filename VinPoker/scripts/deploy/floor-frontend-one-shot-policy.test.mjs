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
    /PRODUCTION_SOURCE_SHA: ad3e8796240ce5a71f860a8d4272dc525489fc37/u,
  );
  assert.match(
    workflow,
    /EXPECTED_PRODUCTION_DEPLOYMENT_SHA: cdb67da6e4f77caa9e3277cea0fe6994f9d41cb6/u,
  );
  assert.match(
    workflow,
    /TARGET_SHA: be52a1f864b6388d06b563c92159fc022885d542/u,
  );
  assert.match(
    workflow,
    /REVIEWED_MERGE_SHA: 2cb8eebcde64551534274787c891c316cf16259d/u,
  );
  assert.match(
    workflow,
    /TARGET_CONTRACT_BLOB: 1b5a272f73f2986c6cb586db701d9368d4ba02be/u,
  );
  assert.match(
    workflow,
    /REVIEWED_CONTRACT_BLOB: 6ed35a3d6ca0cceb81c1de6ce2333417f4d1e9b8/u,
  );
  assert.match(workflow, /environment: dealer-swing-production-critical/u);
  assert.match(workflow, /FRONTEND_RECEIPT_ENVIRONMENT: receipt-vinpoker-frontend/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /required_reviewers/u);
  assert.match(
    workflow,
    /DEPLOY_REVIEWED_FLOOR_SCOPE_STABILITY_FRONTEND/u,
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

test("frontend target delta and reviewed payload boundary remain explicit", () => {
  const targetDelta = [
    "VinPoker/src/hooks/useStableFloorClubIds.test.tsx",
    "VinPoker/src/hooks/useStableFloorClubIds.ts",
    "VinPoker/src/pages/FloorDashboard.tsx",
    "VinPoker/tests/floorProduction/floorDbEdgeContracts.test.ts",
  ];
  for (const path of targetDelta)
    assert.match(workflow, new RegExp(path.replaceAll("/", "\\/"), "u"));
  assert.match(workflow, /expected_target_delta=\(/u);
  assert.match(workflow, /reviewed_payload=\(/u);
  assert.match(workflow, /expected_review_drift="\$contract_path"/u);
  assert.equal(
    workflow.match(/git rev-parse "\$TARGET_SHA:\$contract_path"/gu)?.length,
    2,
  );
  assert.equal(
    workflow.match(/git rev-parse "origin\/main:\$contract_path"/gu)?.length,
    2,
  );
  assert.doesNotMatch(workflow, /deploy_checkout_dealer|checkout-dealer/u);
});
