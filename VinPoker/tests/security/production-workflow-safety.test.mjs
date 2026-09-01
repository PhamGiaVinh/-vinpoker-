import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const workflow = readFileSync(
  resolve(process.cwd(), "..", ".github", "workflows", "vbackerworkflowmain.yml"),
  "utf8",
);

test("production deployment workflow is main-only and keeps credentials in secrets context", () => {
  assert.match(workflow, /branches:\s*\n\s*- main\b/);
  assert.doesNotMatch(workflow, /- master\b/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /deploy-frontend:\s*\n\s*name: Deploy exact reviewed frontend/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /VITE_SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
});

test("production commands remain scoped to the reviewed deployment paths", () => {
  assert.match(workflow, /deploy-critical-edge:/);
  assert.ok(workflow.includes("vercel deploy --prebuilt --prod"));
  assert.doesNotMatch(workflow, /supabase db push/);
});
