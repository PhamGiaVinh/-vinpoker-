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
  assert.match(workflow, /deploy:\s*\n\s*if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /VITE_SUPABASE_PUBLISHABLE_KEY:\s*\$\{\{ secrets\.SUPABASE_PUBLISHABLE_KEY \}\}/);
});

test("production-only commands remain behind the main-only deployment job", () => {
  for (const command of ["supabase db push", "supabase functions deploy", "vercel deploy --prebuilt --prod"]) {
    assert.ok(workflow.includes(command), `expected protected command ${command}`);
  }
});
