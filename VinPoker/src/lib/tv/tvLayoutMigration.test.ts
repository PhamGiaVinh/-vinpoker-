import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924065041_tv_layout_editor_v1.sql"),
  "utf8",
);
const scopedMigration = readFileSync(
  resolve(process.cwd(), "supabase/pending-migrations/20270118000001_tv_tournament_layout_v2.sql"),
  "utf8",
);

describe("TV layout migration architecture", () => {
  it("binds writes to the authenticated TV operator and validates layout server-side", () => {
    expect(migration).toContain("v_actor uuid := auth.uid()");
    expect(migration).toContain("public.is_club_dealer_control(v_actor, p_club_id)");
    expect(migration).toContain("public.is_valid_tv_layout_config(p_layout)");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.is_valid_tv_layout_config(jsonb) TO authenticated, service_role");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1");
  });

  it("keeps paired TV output sanitized and token-bound", () => {
    expect(migration).toContain("v_payload := public.get_tv_display_state(p_display_token)");
    expect(migration).toContain("WHERE d.display_token = p_display_token");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v2(text) TO anon, authenticated");
  });
});

describe("TV layout tournament scope follow-up", () => {
  it("retires the club writer and binds new writes to an event or tournament with revision", () => {
    expect(scopedMigration).toContain("REVOKE ALL ON FUNCTION public.save_tv_branding_layout_v1");
    expect(scopedMigration).toContain("tv_tournament_layout_one_event_v2");
    expect(scopedMigration).toContain("tv_tournament_layout_one_tournament_v2");
    expect(scopedMigration).toContain("coalesce(v_existing.revision, 0) <> p_expected_revision");
    expect(scopedMigration).toContain("public.is_club_floor(v_actor, v_tour.club_id)");
    expect(scopedMigration).toContain("ALTER TABLE public.tv_tournament_layouts ENABLE ROW LEVEL SECURITY");
  });

  it("keeps paired TV reads tied to its assigned tournament and emits branding only", () => {
    expect(scopedMigration).toContain("WHERE display_token = p_display_token AND status = 'paired'");
    expect(scopedMigration).toContain("public.get_tv_tournament_branding_v1(v_tournament_id)");
    expect(scopedMigration).toContain("GRANT EXECUTE ON FUNCTION public.get_tv_display_state_v3(text) TO anon,authenticated");
  });
});
