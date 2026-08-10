import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270110000006_owner_daily_digest_artifact_read_v1.sql"),
  "utf8",
);
const source = readFileSync(resolve(root, "src/ops/digest/ownerDailyDigestSupabaseSource.ts"), "utf8");
const runtimeSource = readFileSync(resolve(root, "src/ops/digest/ownerDailyDigestSupabaseRuntimeSource.ts"), "utf8");

const assertions = [
  [migration.includes("ENABLE ROW LEVEL SECURITY"), "RLS must be enabled"],
  [migration.includes("FORCE ROW LEVEL SECURITY"), "RLS must be forced"],
  [migration.includes("SECURITY INVOKER"), "read RPC must remain SECURITY INVOKER"],
  [migration.includes("c.owner_id = (SELECT auth.uid())"), "club Owner check is required"],
  [migration.includes("REVOKE ALL ON TABLE public.owner_daily_digest_reports FROM PUBLIC, anon, authenticated"), "client write grants must remain revoked"],
  [migration.includes("GRANT SELECT ON TABLE public.owner_daily_digest_reports TO authenticated"), "authenticated read is required for invoker RLS"],
  [migration.includes("GRANT SELECT, INSERT ON TABLE public.owner_daily_digest_reports TO service_role"), "only server role may persist artifacts"],
  [!migration.match(/GRANT\s+(?:UPDATE|DELETE)/iu), "artifacts must remain append-only"],
  [source.includes('rpc("get_latest_owner_daily_digest_artifact"'), "web must use the snapshot RPC"],
  [!source.match(/\.from\s*\(/u), "web must not read domain tables directly"],
  [runtimeSource.includes("opsClient"), "runtime source must use the authenticated Ops client"],
];

const failures = assertions.filter(([ok]) => !ok).map(([, message]) => message);
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("OWNER_DAILY_DIGEST_READ_BOUNDARY_PASS");
