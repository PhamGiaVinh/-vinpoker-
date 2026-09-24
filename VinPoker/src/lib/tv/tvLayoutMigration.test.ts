import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260924065041_tv_layout_editor_v1.sql"),
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
