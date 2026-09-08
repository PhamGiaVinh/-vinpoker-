import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationName = "20270114000004_tracker_voice_floor_mode_global_rollout.sql";
const migration = readFileSync(
  resolve(root, "supabase/migrations", migrationName),
  "utf8",
).replace(/\r\n/g, "\n");

describe("Tracker Voice Floor V3 global authority migration", () => {
  it("uses the next unique migration version without touching historical Voice files", () => {
    const names = [
      ...readdirSync(resolve(root, "supabase/migrations")),
    ].filter((name) => /^\d{14}_.+\.sql$/.test(name));

    expect(names.filter((name) => name.startsWith("20270114000004_"))).toEqual([
      migrationName,
    ]);
    expect(names).toContain("20270114000003_tracker_voice_snake_case_canonical_hash_v2.sql");
  });

  it("defaults both server gates off and prevents legacy app-settings roles from changing them", () => {
    expect(migration).toContain("'tracker_voice_global_enabled', 'false'::JSONB");
    expect(migration).toContain("'tracker_voice_auto_provision_enabled', 'false'::JSONB");
    expect(migration).toContain("tracker_voice_runtime_settings_super_admin_only");
    expect(migration).toContain("AS RESTRICTIVE FOR ALL TO PUBLIC");
    expect(migration).toContain("public.has_role(auth.uid(), 'super_admin'::public.app_role)");
  });

  it("binds enabled configs to the exact V3 session and control epoch", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS table_session_id UUID");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS control_epoch BIGINT");
    expect(migration).toContain("tracker_voice_configs_enabled_session_check");
    expect(migration).toContain("tracker_voice_configs_session_tournament_fkey");
    expect(migration).toContain("tracker_voice_configs_session_game_table_fkey");
    expect(migration).toContain("voice_config_stale");
    expect(migration).toContain("voice_global_disabled");
    expect(migration).toContain("assignment_row.table_session_id = v_table_session.table_session_id");
    expect(migration).toContain("v_active_assignment_count <> 1");
    expect(migration).toContain("v_usable_assignment_count <> 1");
  });

  it("keeps Floor operations available when local Voice sync fails", () => {
    expect(migration).toContain("floor_private.sync_tracker_voice_config");
    expect(migration).toContain("trg_tracker_voice_sync_table_session");
    expect(migration).toContain("trg_tracker_voice_sync_tournament_table");
    expect(migration).toContain("trg_tracker_voice_sync_dealer_assignment");
    expect(migration).toContain("EXCEPTION WHEN OTHERS THEN\n    NULL;");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.floor_open_tournament_table_v3");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.floor_set_table_control_mode_v3");
    expect(migration).not.toContain("CREATE OR REPLACE FUNCTION public.close_tournament_table_v3");
  });

  it("uses the same session-bound gate for browser runtime and Edge snapshots", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_tracker_voice_runtime_context");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.get_tracker_voice_validation_snapshot");
    expect(migration).toContain("hand_row.tournament_table_id = p_tournament_table_id");
    expect(migration).toContain("hand_row.table_session_id = (v_assignment->>'table_session_id')::UUID");
    expect(migration).toContain("floor_private.floor_table_v3_assert_tracker_context(");
    expect(migration).toContain("reconcile_tracker_voice_floor_configs");
    expect(migration).toContain("reconcile_tracker_voice_floor_config(");
    expect(migration).toContain("sync_tracker_voice_config(p_table_session_id, TRUE)");
    expect(migration).toContain("edge_service_role_required");
  });

  it("keeps a canary narrower than future-session auto-provisioning", () => {
    expect(migration).toContain("p_reconcile BOOLEAN DEFAULT FALSE");
    expect(migration).toContain("v_auto_provision_enabled, FALSE) IS NOT TRUE");
    expect(migration).toContain("AND p_reconcile IS NOT TRUE");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.reconcile_tracker_voice_floor_config(UUID)");
    expect(migration).toContain("TO service_role");
  });

  it("does not apply, deploy, or enable Voice as part of source migration", () => {
    expect(migration).not.toMatch(/db push|migration repair|functions deploy|vercel --prod/i);
    expect(migration).not.toMatch(/tracker_voice_auto_commit\s*=\s*true/i);
  });
});
