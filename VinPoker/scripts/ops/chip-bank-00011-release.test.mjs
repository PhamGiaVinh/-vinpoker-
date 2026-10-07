import test from "node:test";
import assert from "node:assert/strict";
import {
  loadRelease, classifyPreflight, classifyPostcheck, buildAtomicQuery,
  validateConnection, preflightSql, postcheckSql,
} from "./chip-bank-00011-release.mjs";

const release = loadRelease();
const pending = {
  database: "postgres", actor: "postgres", required_count: 1,
  required_name: "multi_day_after_end_play_guard_child_binding_v1",
  target_name_count: 0, target_version_count: 0,
  target_name: null, target_sql_sha256: null,
  previous_body_sha256: release.manifest.previousBodySha256,
};

test("exact source and manifest produce one atomic SQL and receipt", () => {
  const query = buildAtomicQuery(release);
  assert.equal(query.match(/\bBEGIN;/g)?.length, 1);
  assert.equal(query.match(/\bCOMMIT;/g)?.length, 1);
  assert.equal(query.match(/INSERT INTO supabase_migrations\.schema_migrations/g)?.length, 1);
  assert.ok(query.includes(release.sql));
  assert.ok(query.indexOf(release.sql) < query.indexOf("INSERT INTO supabase_migrations.schema_migrations"));
  assert.ok(query.includes("SET LOCAL lock_timeout = '5s'"));
  assert.ok(query.includes("pg_advisory_xact_lock(280000, 11)"));
});

test("preflight fails closed on absent predecessor, collision and old body drift", () => {
  assert.equal(classifyPreflight(pending, release), "pending");
  assert.throws(() => classifyPreflight({ ...pending, required_count: 0 }, release));
  assert.throws(() => classifyPreflight({ ...pending, target_name_count: 1 }, release));
  assert.throws(() => classifyPreflight({ ...pending, target_version_count: 1, target_name: "other" }, release));
  assert.throws(() => classifyPreflight({ ...pending, previous_body_sha256: "other" }, release));
  assert.ok(preflightSql().includes("schema_migrations"));
});

test("exact existing receipt is recognized, mismatched SQL is rejected", () => {
  const exact = { ...pending, target_version_count: 1, target_name_count: 1,
    target_name: release.manifest.name, target_sql_sha256: release.manifest.normalizedSqlSha256 };
  assert.equal(classifyPreflight(exact, release), "already-applied-exact");
  assert.throws(() => classifyPreflight({ ...exact, target_sql_sha256: "other" }, release));
});

test("postcheck requires exact receipt, function body and ACL", () => {
  const exact = { receipt_count: 1, receipt_sql_sha256: release.manifest.normalizedSqlSha256,
    body_sha256: release.expectedBodySha256, anon_execute: false, authenticated_execute: true };
  assert.equal(classifyPostcheck(exact, release), "postcheck-passed");
  assert.throws(() => classifyPostcheck({ ...exact, body_sha256: "other" }, release));
  assert.throws(() => classifyPostcheck({ ...exact, anon_execute: true }, release));
  assert.throws(() => classifyPostcheck({ ...exact, authenticated_execute: false }, release));
  assert.ok(postcheckSql().includes("has_function_privilege"));
});

test("connection context must pin the production project", () => {
  const env = { SUPABASE_PROJECT_REF: "orlesggcjamwuknxwcpk", PGHOST: "db.orlesggcjamwuknxwcpk.supabase.co",
    PGPORT: "5432", PGUSER: "postgres", PGDATABASE: "postgres", PGSSLMODE: "require", PGPASSWORD: "placeholder" };
  assert.doesNotThrow(() => validateConnection(env));
  assert.throws(() => validateConnection({ ...env, PGHOST: "other" }));
  assert.throws(() => validateConnection({ ...env, PGPASSWORD: "" }));
});
