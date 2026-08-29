import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(
  resolve(process.cwd(), "../.github/workflows/tracker-pr2a-disposable-db.yml"),
  "utf8",
).replace(/\r\n/g, "\n");
const baseline = readFileSync(
  resolve(process.cwd(), "tests/trackerUnifiedOps/disposableDb.baseline.sql"),
  "utf8",
);
const integration = readFileSync(
  resolve(process.cwd(), "tests/trackerUnifiedOps/disposableDb.integration.sql"),
  "utf8",
);
const legacyModeIntegration = readFileSync(
  resolve(process.cwd(), "tests/trackerUnifiedOps/legacyWriterMode.integration.sql"),
  "utf8",
);
const containedModeIntegration = readFileSync(
  resolve(
    process.cwd(),
    "tests/trackerUnifiedOps/legacyWriterMode.containment.integration.sql",
  ),
  "utf8",
);
const legacyCloseIntegration = readFileSync(
  resolve(
    process.cwd(),
    "tests/trackerUnifiedOps/legacyWriterClose.integration.sql",
  ),
  "utf8",
);
const identityColumnsIntegration = readFileSync(
  resolve(
    process.cwd(),
    "tests/trackerUnifiedOps/handPlayerIdentityColumns.integration.sql",
  ),
  "utf8",
);
const legacyModeSource = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migration-archive/historical-never-replay/20270105000004_floor_table_control_mode.sql",
  ),
  "utf8",
);
const containmentMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migration-archive/superseded/replaced/20270108000004_tracker_unified_ops_writer_lock_containment.sql",
  ),
  "utf8",
);

describe("Tracker PR2A disposable database contract", () => {
  it("uses PostgreSQL 17 with trust auth and read-only repository permissions", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("POSTGRES_HOST_AUTH_METHOD: trust");
    expect(workflow).toContain("permissions:\n  contents: read");
  });

  it("does not contain linked-project, deployment, or production commands", () => {
    expect(workflow).not.toMatch(/--linked|db push|functions deploy|vercel --prod/i);
    expect(workflow).not.toContain("orlesggcjamwuknxwcpk");
    expect(workflow).not.toMatch(/SUPABASE_(URL|KEY|SERVICE_ROLE_KEY)/i);
  });

  it("applies the exact migration and tests a separate clean rollback copy", () => {
    expect(workflow).toContain(
      "supabase/migrations/20270108000003_tracker_unified_ops_v2_context_safe_start.sql",
    );
    expect(workflow).toContain(
      "supabase/migration-archive/superseded/replaced/20270108000004_tracker_unified_ops_writer_lock_containment.sql",
    );
    expect(workflow).toContain("createdb tracker_pr2a_rollback -T tracker_pr2a");
    expect(workflow).toContain("tracker_pr2a_injected_failure");
    expect(workflow).toContain("PR2A_ROLLBACK_PROOF=PASS");
  });

  it("runs the identity-column forward repair against the runtime drift shape", () => {
    expect(workflow).toContain(
      "supabase/migration-archive/historical-never-replay/20270110000002_hand_players_identity_columns_forward_fix.sql",
    );
    expect(workflow).toContain("createdb tracker_hand_player_identity");
    expect(workflow).toContain(
      "tests/trackerUnifiedOps/handPlayerIdentityColumns.integration.sql",
    );
    expect(identityColumnsIntegration).toContain(
      "PRE_MIGRATION_UNDEFINED_COLUMN_REPRODUCED",
    );
    expect(identityColumnsIntegration).toContain(
      "POST_MIGRATION_FUNCTION_RUNTIME_PASS",
    );
    expect(identityColumnsIntegration).toContain(
      "HAND_PLAYER_IDENTITY_FORWARD_REPAIR_PASS",
    );
  });

  it("keeps the Deno check bounded to a non-PR2A syntax target", () => {
    expect(workflow).toContain("denoland/setup-deno@v2");
    expect(workflow).toContain(
      "deno check --no-config supabase/functions/health/index.ts",
    );
    expect(workflow).toContain("PR2A_DENO=PASS_HEALTH_BASELINE_NO_PR2A_EDGE_SOURCE");
  });

  it("keeps the canonical identity domains explicit in the baseline", () => {
    expect(baseline).toContain(
      "canonical identities: seats point at tournament_tables.id; entries point at game_tables.id",
    );
    expect(baseline).toContain("CREATE TABLE public.tournament_tables");
    expect(baseline).toContain("CREATE TABLE public.tournament_entries");
    expect(baseline).toContain("CREATE TABLE public.tournament_hands");
  });

  it("covers wrong-seat zero-write, raw hash, idempotency and terminal replay", () => {
    expect(integration).toContain("seat_entry_mismatch");
    expect(integration).toContain("wrong seat_number performs zero hand writes");
    expect(integration).toContain("negative tracker stack changes context hash");
    expect(integration).toContain("same idempotency request returns replayed receipt");
    expect(integration).toContain("terminal tournament does not block an exact receipt replay");
  });

  it("covers authorization, privacy, advisory-lock concurrency and no auto-void", () => {
    expect(integration).toContain("start RPC grants only authenticated execution");
    expect(integration).toContain("receipt table is not client-readable");
    expect(integration).toContain("concurrent different-key starts serialize without duplicate hands");
    expect(integration).toContain("no stale-lock auto-void or destructive cleanup occurred");
    expect(integration).toContain("dblink_send_query");
  });

  it("runs the exact current-main mode writer and records deadlock evidence", () => {
    expect(workflow).toContain("legacyWriterMode.dependencies.sql");
    expect(workflow).toContain("legacyWriterMode.containment.integration.sql");
    expect(legacyModeSource).toContain(
      "CREATE OR REPLACE FUNCTION public.floor_set_table_control_mode(",
    );
    expect(legacyModeIntegration).toContain("wait_event_type = 'Lock'");
    expect(legacyModeIntegration).toContain("dblink_is_busy");
    expect(legacyModeIntegration).toContain("40P01");
    expect(legacyModeIntegration).toContain(
      "PR2A_LEGACY_MODE_DEADLOCK_PROOF=PASS",
    );
    expect(containmentMigration).toContain(
      "public.tracker_unified_ops_lock_tournament(p_tournament_id)",
    );
    expect(containmentMigration).toContain(
      "tracker_unified_ops_lock_tournament(uuid) is required before writer containment",
    );
    expect(containedModeIntegration).toContain("MODE_WRITER_RACE_PASS");
    expect(containedModeIntegration).toContain("table_has_active_hand");
    expect(containedModeIntegration).toContain("stale_table_context");
    expect(containedModeIntegration).toContain("NOT EXISTS (");
    expect(containedModeIntegration).toContain(
      "DROP TABLE public.tracker_legacy_mode_context_shared",
    );
  });

  it("runs the exact canonical Close Table suite in both race directions", () => {
    expect(workflow).toContain("createdb tracker_pr2a_close");
    expect(workflow).toContain(
      "tests/trackerUnifiedOps/legacyWriterClose.integration.sql",
    );
    expect(legacyCloseIntegration).toContain(
      "20270108000004_tracker_unified_ops_writer_lock_containment.sql",
    );
    expect(legacyCloseIntegration).toContain(
      "close table canonical disposable DB integration passed",
    );
    expect(legacyCloseIntegration).toContain("CLOSE_TABLE_RACE_PASS");
    expect(legacyCloseIntegration).toContain("table_has_active_hand");
    expect(legacyCloseIntegration).toContain(
      "tracker_test_v2_start_attempt",
    );
    expect(legacyCloseIntegration).toContain("wait_event_type = 'Lock'");
    expect(legacyCloseIntegration).toContain("dblink_is_busy");
    expect(legacyCloseIntegration).toContain("40P01");
    expect(legacyCloseIntegration).toContain(
      "DIFFERENT_TOURNAMENT_INDEPENDENCE_PASS",
    );
    expect(legacyCloseIntegration).toContain("REMAINING_WRITER_RACE_PASS");
    expect(legacyCloseIntegration).toContain(
      "RESTORE_REENTRY_NOT_MEASURED_IDENTITY_DEPENDENCIES",
    );
    expect(legacyCloseIntegration).toContain(
      "ALTER COLUMN id SET DEFAULT gen_random_uuid()",
    );
    expect(legacyCloseIntegration).toContain(
      "ALTER TABLE public.tournament_registrations",
    );
  });
});
