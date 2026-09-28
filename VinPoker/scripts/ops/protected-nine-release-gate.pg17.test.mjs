import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildAtomicMigrationQuery, classifyTarget, normalizedHash, ORDER } from "./protected-nine-release-gate.mjs";

const psql = (sql) => {
  const result = spawnSync("psql", ["-X", "-v", "ON_ERROR_STOP=1", "-At"], { input: sql, encoding: "utf8", env: process.env });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
};

test("PostgreSQL 17 simulates plan/apply/hash/postcheck one entry at a time", () => {
  psql("DROP SCHEMA IF EXISTS supabase_migrations CASCADE; CREATE SCHEMA supabase_migrations; CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY,name text NOT NULL,statements text[] NOT NULL);");
  const entries = ORDER.map((version, index) => {
    const sql = `CREATE TABLE public.protected_nine_fixture_${index + 1}(id integer);`;
    return { newVersion: version, semanticName: `fixture_${index + 1}`, filename: `${version}_fixture_${index + 1}.sql`, normalizedSqlSha256: normalizedHash(sql), dependencies: index ? [ORDER[index - 1]] : [], requiredReceipts: index ? [{ version: ORDER[index - 1], semanticName: `fixture_${index}` }] : [], sql, postcheck: { queries: [`SELECT (to_regclass('public.protected_nine_fixture_${index + 1}') IS NOT NULL) AS ok`] } };
  });
  const history = [];
  for (const entry of entries) {
    assert.equal(classifyTarget(history, entries, entry.newVersion), "pending");
    psql(buildAtomicMigrationQuery(entry));
    const receipt = JSON.parse(psql(`SELECT json_build_object('version',version,'name',name,'statements',statements) FROM supabase_migrations.schema_migrations WHERE version='${entry.newVersion}'`));
    history.push(receipt);
    assert.equal(classifyTarget(history, entries, entry.newVersion), "already-applied-exact");
    assert.equal(psql(entry.postcheck.queries[0]), "t");
  }
  assert.equal(psql("SELECT count(*) FROM supabase_migrations.schema_migrations"), "9");
});

