import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "../..");
const archive = resolve(root, "supabase/migration-archive/live-duplicate-20270115000019.manifest.json");
const migrationDir = resolve(root, "supabase/migrations");

test("live-only 00019 is documented without adding a replayable duplicate", () => {
  const manifest = JSON.parse(readFileSync(archive, "utf8"));
  assert.equal(manifest.liveVersion, "20270115000019");
  assert.equal(manifest.canonicalSourceVersion, "20270115000020");
  assert.equal(existsSync(resolve(migrationDir, "20270115000019_tracker_voice_floor_owner_authority.sql")), false);

  const sql = readFileSync(resolve(root, "supabase", manifest.canonicalSourceFile), "utf8")
    .replace(/\r\n/g, "\n");
  const sha256 = createHash("sha256").update(sql, "utf8").digest("hex");
  assert.equal(sha256, manifest.normalizedSqlSha256);
  assert.match(sql, /voice_actor_is_owner_or_floor/);
  assert.match(sql, /tracker_voice_floor_owner_authority_source_precondition_failed/);
});

test("36 remote-applied SQL bodies remain pinned in pending catalog", () => {
  const manifest = JSON.parse(readFileSync(archive, "utf8"));
  const versions = new Set([
    "20260924065041", "20260924165219", "20260925092509",
    "20270117000001", "20270117000002", "20270118000001", "20270118000002",
    ...Array.from({ length: 15 }, (_, index) => `202701190000${String(index).padStart(2, "0")}`),
    ...Array.from({ length: 13 }, (_, index) => `202701200000${String(index).padStart(2, "0")}`),
    "20270126000001",
  ]);
  const pendingDir = resolve(root, "supabase/pending-migrations");
  const files = readdirSync(pendingDir).filter((name) => versions.has(name.slice(0, 14))).sort();
  assert.equal(files.length, manifest.exactLiveMatchedPendingCount);
  const lines = files.map((name) => {
    const sql = readFileSync(resolve(pendingDir, name), "utf8").replace(/\r\n/g, "\n");
    const md5 = createHash("md5").update(sql, "utf8").digest("hex");
    return `${name.slice(0, 14)}:${name.slice(15, -4)}:${md5}`;
  });
  const aggregate = createHash("sha256").update(lines.join("\n"), "utf8").digest("hex");
  assert.equal(aggregate, manifest.exactLiveMatchedPendingAggregateSha256);
});
