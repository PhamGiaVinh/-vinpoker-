import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migration = read("supabase/migrations/20270110000012_owner_daily_digest_report_access_v2.sql");
const flags = read("src/lib/featureFlags.ts");
const page = read("src/pages/OwnerDailyDigest.tsx");
const source = read("src/ops/digest/ownerDailyDigestV2Source.ts");
const actorTest = read("supabase/tests/owner_daily_digest_report_access_v2.sql");

const checks = [
  ["V2 capability defaults OFF", /ownerDailyDigestSnapshotV2:\s*false/u.test(flags)],
  ["manager event ledger is append-only", /owner_digest_manager_events_immutable_v2[\s\S]*BEFORE UPDATE OR DELETE/u.test(migration)],
  ["global Club Admin alone is insufficient", /owner_daily_digest_access_granted_v2[\s\S]*candidate_active_v2[\s\S]*has_role\(p_user_id, 'club_admin'/u.test(migration)],
  ["revoke follows latest ledger state rather than current role", /owner_daily_digest_access_state_granted_v2[\s\S]*ACCESS_GRANTED[\s\S]*ACCESS_REVOKED[\s\S]*revoke_owner_daily_digest_manager_v2[\s\S]*IF NOT private\.owner_daily_digest_access_state_granted_v2/u.test(migration)],
  ["V1 scope writes mirror into V2 during cutover", /owner_daily_digest_v1_scope_sync_v2[\s\S]*sync_owner_daily_digest_v1_scope_to_v2[\s\S]*V1_SCOPE_SYNC/u.test(migration)],
  ["V2 grant and revoke mirror the live V1 scope", /grant_owner_daily_digest_manager_v2[\s\S]*INSERT INTO public\.owner_daily_digest_club_admin_scopes[\s\S]*revoke_owner_daily_digest_manager_v2[\s\S]*DELETE FROM public\.owner_daily_digest_club_admin_scopes/u.test(migration)],
  ["manager reads require per-Club enablement", /owner_daily_digest_manager_active_v2[\s\S]*manager_access_enabled/u.test(migration)],
  ["Owner cannot prepare candidates", /prepare_owner_daily_digest_manager_candidate_v2[\s\S]*has_role\(v_actor, 'super_admin'/u.test(migration)],
  ["snapshot read binds to auth.uid", /get_owner_daily_digest_snapshot_v2[\s\S]*v_user_id uuid := \(SELECT auth\.uid\(\)\)[\s\S]*can_read_owner_daily_digest_v2/u.test(migration)],
  ["explicit date cannot fall back", /p_business_date IS NULL OR s\.business_date = p_business_date/u.test(migration)],
  ["regeneration is bounded and idempotent", /request_owner_daily_digest_regeneration_v2[\s\S]*90[\s\S]*client_request_id[\s\S]*pg_advisory_xact_lock/u.test(migration)],
  ["private manager ledger has no client grant", !/GRANT[^;]*owner_daily_digest_manager_events_v2[^;]*\b(?:anon|authenticated)\b/iu.test(migration)],
  ["actor matrix uses the authenticated database role", /SET LOCAL ROLE authenticated[\s\S]*\$authenticated_matrix\$/u.test(actorTest)],
  ["actor matrix checks anon and private privileges", /has_function_privilege\('anon'[\s\S]*has_table_privilege\('authenticated'/u.test(actorTest)],
  ["actor matrix exercises post-seed V1 cutover writes", /V1 revoke\/grant after the seed[\s\S]*grant_owner_daily_digest_club_admin_scope[\s\S]*post-migration V1 revoke/u.test(actorTest)],
  ["actor matrix prevents dormant grant resurrection", /Owner must still be able to revoke the dormant ledger grant[\s\S]*revoke_owner_daily_digest_manager_v2[\s\S]*restored role resurrected a revoked Club grant/u.test(actorTest)],
  ["web consumes V2 RPC instead of aggregating", /get_owner_daily_digest_snapshot_v2/u.test(source) && !/\.from\(/u.test(source)],
  ["manager UI is V2 gated", /ownerDailyDigestSnapshotV2/u.test(page) && /OwnerDigestAccessPanel/u.test(page)],
  ["unauthorized Club URL does not fall back", /requestedClubId\s*\?[\s\S]*clubs\.find\([\s\S]*\?\? null[\s\S]*requestedClubDenied/u.test(page)],
  ["refresh and regeneration are distinct", /Làm mới màn hình/u.test(read("src/ops/digest/OwnerDailyDigestView.tsx")) && /Tạo lại báo cáo/u.test(read("src/ops/digest/OwnerDigestRegenerationButton.tsx"))],
];

let failed = false;
for (const [name, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  failed ||= !pass;
}
if (failed) process.exit(1);

function read(path) {
  return readFileSync(resolve(root, path), "utf8");
}
