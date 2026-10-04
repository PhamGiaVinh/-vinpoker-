import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(
  process.cwd(),
  "supabase/migrations/20270128000005_tracker_correction_floor_tracker_authority.sql",
), "utf8").replace(/\r\n/g, "\n");

describe("Tracker correction Floor/Tracker authority", () => {
  it("accepts exact-scoped Floor or Tracker authority without Dealer impersonation", () => {
    expect(migration).toContain("public.is_club_tracker(v_actor, v_context.club_id)");
    expect(migration).toContain("public.is_club_floor(v_actor, v_context.club_id)");
    expect(migration).toContain("public.is_club_owner(v_actor, v_context.club_id)");
    expect(migration).toContain("public.is_club_admin(v_actor, v_context.club_id)");
    expect(migration).not.toContain("JOIN public.dealer_assignments");
    expect(migration).toContain("ALTER COLUMN dealer_id DROP NOT NULL");
    expect(migration).toContain("ALTER COLUMN assignment_id DROP NOT NULL");
  });

  it("keeps Tracker lock, exact scope, active hand, and revision guards", () => {
    expect(migration).toContain("scope_row.user_id = v_actor");
    expect(migration).toContain("scope_row.tournament_table_id = p_tournament_table_id");
    expect(migration).toContain("v_context.control_mode <> 'tracker'");
    expect(migration).toContain("v_context.hand_status <> 'in_progress'");
    expect(migration).toContain("tracker_lock_not_owned");
    expect(migration).toContain("stale_source_revision");
  });

  it("reports the whole hand idempotently without an action reference", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.report_tracker_wrong_hand_v1");
    expect(migration).toContain("'scope', 'whole_hand'");
    expect(migration).toContain("v_prior.source_action_id IS NOT NULL");
    expect(migration).toContain("'correction_pending'");
    expect(migration).toContain("'tracker_wrong_hand_reported'");
  });
});
