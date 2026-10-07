import assert from "node:assert/strict";
import { test } from "node:test";
import {
  atomicSql, classifyPostcheck, classifyPreflight, loadRelease, postcheckSql,
  preflightSql, validateConnection,
} from "./felt-00012-release.mjs";

test("exact SQL is pinned and the migration's transaction wrapper is replaced", () => {
  const release = loadRelease();
  assert.equal(release.hash, "3185b1c3c367d8ccf814023b31d3bfaeb52059fe5149db145e63385fc7e9b612");
  const apply = atomicSql(release);
  const executable = apply.split("INSERT INTO supabase_migrations.schema_migrations")[0];
  assert.equal((executable.match(/^BEGIN;$/gm) || []).length, 1);
  assert.equal((executable.match(/^COMMIT;$/gm) || []).length, 0);
  assert.match(apply, /INSERT INTO supabase_migrations\.schema_migrations/);
  assert.ok(apply.indexOf("CREATE OR REPLACE FUNCTION") < apply.indexOf("INSERT INTO supabase_migrations.schema_migrations"));
  assert.ok(apply.indexOf("INSERT INTO supabase_migrations.schema_migrations") < apply.lastIndexOf("COMMIT;"));
});

test("preflight and postcheck reject ledger drift", () => {
  assert.match(preflightSql(), /20270128000011/);
  assert.match(postcheckSql(), /receipt_sha256/);
  const good = { database: "postgres", actor: "postgres", predecessor_count: 1,
    target_version_count: 0, target_name_count: 0, voice_duplicate_equal: true };
  assert.equal(classifyPreflight(good), "pending");
  assert.throws(() => classifyPreflight({ ...good, target_version_count: 1 }));
  assert.throws(() => classifyPreflight({ ...good, voice_duplicate_equal: false }));
  const post = { receipt_count: 1,
    receipt_sha256: "3185b1c3c367d8ccf814023b31d3bfaeb52059fe5149db145e63385fc7e9b612",
    tour_guard: true, trigger_count: 3, dealer_readiness: true, tournament_readiness: true,
    dealer_anon_execute: false, dealer_authenticated_execute: true,
    anon_execute: false, authenticated_execute: true };
  assert.equal(classifyPostcheck(post), "pass");
  assert.throws(() => classifyPostcheck({ ...post, receipt_sha256: "wrong" }));
  assert.throws(() => classifyPostcheck({ ...post, trigger_count: 2 }));
});

test("connection preflight does not infer a project from generic credentials", () => {
  const good = { SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk",
    PGHOST: "aws-1-ap-southeast-2.pooler.supabase.com", PGPORT: "5432",
    PGUSER: "postgres.orlesggcjamwuknxwcpk", PGDATABASE: "postgres",
    PGSSLMODE: "require", PGPASSWORD: "test-only" };
  assert.doesNotThrow(() => validateConnection(good));
  assert.throws(() => validateConnection({ ...good, PGHOST: "localhost" }));
});
