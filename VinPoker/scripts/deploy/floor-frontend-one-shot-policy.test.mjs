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
    /PRODUCTION_SOURCE_SHA: 3d54c87e7c1fab1209494c94b7b2cca042053e2d/u,
  );
  assert.match(
    workflow,
    /EXPECTED_PRODUCTION_DEPLOYMENT_SHA: cdb67da6e4f77caa9e3277cea0fe6994f9d41cb6/u,
  );
  assert.match(
    workflow,
    /TARGET_SHA: ca95d444329b39efb74913d3bfd37150364fcd96/u,
  );
  assert.match(
    workflow,
    /REVIEWED_MERGE_SHA: 96d31dbb553b50ecb11c417f3ae748edec497c11/u,
  );
  assert.match(workflow, /environment: dealer-swing-production-critical/u);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/u);
  assert.match(workflow, /required_reviewers/u);
  assert.match(
    workflow,
    /git diff --quiet "\$TARGET_SHA" "\$REVIEWED_MERGE_SHA"/u,
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

test("frontend source allowlist remains exactly the two reviewed Floor RPC binding files", () => {
  const allowlist = [
    "VinPoker/src/components/ops/shared/FloorPlayerActions.tsx",
    "VinPoker/src/pages/ops/OpsTournamentCockpit.tsx",
  ];
  for (const path of allowlist)
    assert.match(workflow, new RegExp(path.replaceAll("/", "\\/"), "u"));
  assert.doesNotMatch(workflow, /deploy_checkout_dealer|checkout-dealer/u);
});
