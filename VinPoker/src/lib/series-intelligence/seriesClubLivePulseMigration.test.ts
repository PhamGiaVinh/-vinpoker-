import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270110000003_series_club_live_pulse_v1.sql"),
  "utf8",
);

describe("Series Club Pulse V1 source-only migration", () => {
  it("pins the owner-scoped SECURITY DEFINER boundary and narrow grant", () => {
    expect(MIGRATION).toMatch(/get_series_club_live_pulse_v1\(p_club_id uuid\)[\s\S]*SECURITY DEFINER[\s\S]*SET search_path = ''/);
    expect(MIGRATION).toContain("auth.uid()");
    expect(MIGRATION).toContain("public.is_club_owner(v_actor, p_club_id)");
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.get_series_club_live_pulse_v1(uuid) FROM PUBLIC");
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.get_series_club_live_pulse_v1(uuid) FROM anon");
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.get_series_club_live_pulse_v1(uuid) FROM service_role");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.get_series_club_live_pulse_v1(uuid) TO authenticated");
  });

  it("uses server time and the canonical club timezone without a UTC-day fallback", () => {
    expect(MIGRATION).toContain("clock_timestamp()");
    expect(MIGRATION).toContain("FROM public.club_settings AS cs");
    expect(MIGRATION).toContain("FROM pg_catalog.pg_timezone_names");
    expect(MIGRATION).toContain("CLUB_TIMEZONE_UNAVAILABLE");
    expect(MIGRATION).not.toMatch(/CURRENT_DATE/);
  });

  it("keeps the seven metric semantics explicit and aggregate-only", () => {
    expect(MIGRATION).toContain("tr.status = 'confirmed'");
    expect(MIGRATION).toContain("tr.confirmed_at >= v_day_start");
    expect(MIGRATION).toContain("t.status IN ('live', 'break', 'final_table')");
    expect(MIGRATION).toContain("ts.is_active IS TRUE");
    expect(MIGRATION).toContain("ts.status = 'active'");
    expect(MIGRATION).toContain("tt.status = 'active'");
    expect(MIGRATION).toContain("da.status = 'checked_in'");
    expect(MIGRATION).toContain("da.check_out_time IS NULL");
    expect(MIGRATION).not.toMatch(/jsonb_(?:agg|build_object)\([^;]*(?:player_id|dealer_id|registration_id|seat_id|table_id)/i);
  });

  it("fails counts closed beyond the JavaScript safe-integer boundary", () => {
    expect(MIGRATION.match(/9007199254740991/g)?.length).toBeGreaterThanOrEqual(7);
    expect(MIGRATION.match(/COUNT_EXCEEDS_JS_SAFE_INTEGER/g)?.length).toBeGreaterThanOrEqual(7);
  });
});
