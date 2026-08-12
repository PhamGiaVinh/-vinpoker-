import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270110000006_owner_daily_digest_artifact_read_v1.sql"),
  "utf8",
);
const clubAdminScopeMigration = readFileSync(
  resolve(root, "supabase/migrations/20270110000008_club_admin_digest_scope_v1.sql"),
  "utf8",
);
const source = readFileSync(resolve(root, "src/ops/digest/ownerDailyDigestSupabaseSource.ts"), "utf8");
const runtimeSource = readFileSync(resolve(root, "src/ops/digest/ownerDailyDigestSupabaseRuntimeSource.ts"), "utf8");
const clubScopeSource = readFileSync(resolve(root, "src/ops/digest/ownerDailyDigestClubScopeSource.ts"), "utf8");
const pageSource = readFileSync(resolve(root, "src/pages/OwnerDailyDigest.tsx"), "utf8");

const assertions = [
  [migration.includes("ENABLE ROW LEVEL SECURITY"), "RLS must be enabled"],
  [migration.includes("FORCE ROW LEVEL SECURITY"), "RLS must be forced"],
  [migration.includes("SECURITY INVOKER"), "read RPC must remain SECURITY INVOKER"],
  [migration.includes("c.owner_id = (SELECT auth.uid())"), "club Owner check is required"],
  [migration.includes("REVOKE ALL ON TABLE public.owner_daily_digest_reports FROM PUBLIC, anon, authenticated"), "client write grants must remain revoked"],
  [migration.includes("GRANT SELECT ON TABLE public.owner_daily_digest_reports TO authenticated"), "authenticated read is required for invoker RLS"],
  [migration.includes("GRANT SELECT, INSERT ON TABLE public.owner_daily_digest_reports TO service_role"), "only server role may persist artifacts"],
  [!migration.match(/GRANT\s+(?:UPDATE|DELETE)/iu), "artifacts must remain append-only"],
  [clubAdminScopeMigration.includes("CREATE TABLE IF NOT EXISTS public.owner_daily_digest_club_admin_scopes"), "Club Admin scope table is required"],
  [clubAdminScopeMigration.includes("ENABLE ROW LEVEL SECURITY"), "Club Admin scope table must enable RLS"],
  [clubAdminScopeMigration.includes("FORCE ROW LEVEL SECURITY"), "Club Admin scope table must force RLS"],
  [clubAdminScopeMigration.includes("REVOKE ALL ON TABLE public.owner_daily_digest_club_admin_scopes FROM PUBLIC, anon, authenticated"), "Club Admin scope table must not be directly client-readable"],
  [clubAdminScopeMigration.includes("p_user_id = (SELECT auth.uid())"), "Club Admin scope predicate must bind its user to the caller"],
  [clubAdminScopeMigration.includes("public.has_role(p_user_id, 'club_admin'::public.app_role)"), "Club Admin scope predicate must require the global role and explicit Club scope"],
  [clubAdminScopeMigration.includes("public.can_read_owner_daily_digest((SELECT auth.uid()), owner_daily_digest_reports.club_id)"), "digest RLS must use the scoped Club Admin predicate"],
  [clubAdminScopeMigration.includes("CREATE OR REPLACE FUNCTION public.list_owner_daily_digest_clubs()"), "server-scoped Club list RPC is required"],
  [clubAdminScopeMigration.includes("REVOKE ALL ON FUNCTION public.list_owner_daily_digest_clubs()\n  FROM PUBLIC, anon"), "Club list RPC must not be public"],
  [source.includes('rpc("get_latest_owner_daily_digest_artifact"'), "web must use the snapshot RPC"],
  [!source.match(/\.from\s*\(/u), "web must not read domain tables directly"],
  [runtimeSource.includes("opsClient"), "runtime source must use the authenticated Ops client"],
  [clubScopeSource.includes('rpc("list_owner_daily_digest_clubs")'), "web must use the server-scoped Club list RPC"],
  [!pageSource.match(/supabase\.from\s*\(/u), "digest page must not list Clubs directly"],
];

const failures = assertions.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("OWNER_DAILY_DIGEST_READ_BOUNDARY_PASS");
