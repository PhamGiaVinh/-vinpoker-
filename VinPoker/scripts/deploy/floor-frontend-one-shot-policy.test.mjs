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
    /PRODUCTION_BASELINE_SHA: cdb67da6e4f77caa9e3277cea0fe6994f9d41cb6/u,
  );
  assert.match(
    workflow,
    /TARGET_SHA: 3d54c87e7c1fab1209494c94b7b2cca042053e2d/u,
  );
  assert.match(
    workflow,
    /REVIEWED_MERGE_SHA: ee77f095f27bdbc7c9b9bfbc561969fe2b5559ad/u,
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
  assert.match(workflow, /vercel env run --environment=production/u);
  assert.match(workflow, /trap 'rm -f \.vercel\/project\.json' EXIT/u);
  assert.match(workflow, /"Cache-Control":"no-cache, must-revalidate"/u);
  assert.match(workflow, /git diff --quiet "\$TARGET_SHA" origin\/main/u);
  assert.match(workflow, /cmp --silent VinPoker\/dist\/version\.json/u);
  assert.match(workflow, /--component frontend/u);
});

test("frontend source allowlist remains exactly the four reviewed Floor clock files", () => {
  const allowlist = [
    "VinPoker/src/components/cashier/tournament-live/ClockPanel.tsx",
    "VinPoker/src/lib/tournament/clockControlState.test.ts",
    "VinPoker/src/lib/tournament/clockControlState.ts",
    "VinPoker/src/pages/ops/OpsTournamentCockpit.tsx",
  ];
  for (const path of allowlist)
    assert.match(workflow, new RegExp(path.replaceAll("/", "\\/"), "u"));
  assert.doesNotMatch(workflow, /deploy_checkout_dealer|checkout-dealer/u);
});
