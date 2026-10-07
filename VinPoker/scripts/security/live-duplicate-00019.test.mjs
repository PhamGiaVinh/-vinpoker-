import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
