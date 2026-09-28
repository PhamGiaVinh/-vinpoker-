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
    expect(migration).toContain("IF p_capability = 'report_wrong_hand' THEN");
    expect(migration).toContain("ALTER COLUMN dealer_id DROP NOT NULL");
    expect(migration).toContain("ALTER COLUMN assignment_id DROP NOT NULL");
  });

  it("keeps Tracker lock, exact scope, active hand, and revision guards", () => {
    expect(migration).toContain("'report_wrong_hand'");
    expect(migration).toContain("v_scope_capability := CASE");
    expect(migration).toContain("WHEN p_capability = 'report_wrong_hand' THEN 'report_wrong_action'");
    expect(migration).toContain("scope_row.user_id = v_actor");
    expect(migration).toContain("scope_row.tournament_table_id = p_tournament_table_id");
    expect(migration).toContain("s.id = tt.table_session_id AND s.tournament_id = t.id");
    expect(migration).toContain("h.tournament_table_id = tt.id AND h.table_session_id = s.id");
    expect(migration).toContain("v_context.control_mode <> 'tracker'");
    expect(migration).toContain("v_context.hand_status <> 'in_progress'");
    expect(migration).toContain("tracker_lock_not_owned");
    expect(migration).toContain("stale_source_revision");
  });

  it("keeps action-level report and undo on the original Tracker Dealer authority", () => {
    expect(migration).toMatch(/p_capability NOT IN \(\s*'report_wrong_action', 'report_wrong_hand', 'undo_open_hand'\s*\)/);
    expect(migration).toContain("IF p_capability = 'report_wrong_hand' THEN");
    expect(migration).toContain("dealer_assignment_not_unique");
    expect(migration).toContain("attendance.status IN ('checked_in', 'overtime')");
    expect(migration).toContain("v_context.locked_by_user_id IS DISTINCT FROM v_actor");
    expect(migration).toContain("p_tournament_id, p_tournament_table_id, p_hand_id, 'report_wrong_hand'");
  });

  it("reports the whole hand idempotently without an action reference", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.report_tracker_wrong_hand_v1");
    expect(migration).toContain("'scope', 'whole_hand'");
    expect(migration).toContain("'tournament_id', p_tournament_id");
    expect(migration).toContain("'tournament_table_id', p_tournament_table_id");
    expect(migration).toContain("v_prior.source_action_id IS NOT NULL");
    expect(migration).toContain("'correction_pending'");
    expect(migration).toContain("'progression_guard', 'tracker_floor_alert'");
    expect(migration).toContain("'tracker_wrong_hand_reported'");
  });

  it("keeps whole-hand alerts visible without Dealer or action references", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.list_tracker_floor_alerts");
    expect(migration).toContain("LEFT JOIN public.dealers d ON d.id = a.dealer_id");
    expect(migration).toContain("'assignment_id', a.assignment_id");
    expect(migration).toContain("'source_action_id', a.source_action_id");
    expect(migration).toContain("public.is_club_owner(v_actor, v_club_id)");
  });
});
