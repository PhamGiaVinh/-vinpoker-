import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  join(process.cwd(), "supabase/migrations/20270110000004_series_v_candidate_and_rate_limit_v1.sql"),
  "utf8",
);

describe("Series V candidate and durable rate-limit migration", () => {
  it("exposes only approved owner-scoped candidates through the fixed RPC", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.series_schedule_candidates_v1");
    expect(MIGRATION).toContain("lifecycle IN ('draft','approved','archived')");
    expect(MIGRATION).toContain("c.lifecycle = 'approved'");
    expect(MIGRATION).toContain("NOT EXISTS (");
    expect(MIGRATION).toContain("public.is_club_owner(v_actor, p_club_id)");
    expect(MIGRATION).toContain("GRANT EXECUTE ON FUNCTION public.series_get_approved_schedule_candidates_v1(uuid, text[])");
    expect(MIGRATION).not.toMatch(/GRANT (?:INSERT|UPDATE|DELETE|ALL).*series_schedule_candidates_v1.*authenticated/i);
  });

  it("derives required field and leaves unsupported evidence states unknown", () => {
    expect(MIGRATION).toContain("pg_catalog.ceil(gtd_vnd::numeric / prize_contribution_per_entry_vnd::numeric)::bigint");
    expect(MIGRATION).toContain("WHEN prize_contribution_per_entry_vnd IS NULL THEN NULL");
    expect(MIGRATION).toContain("WHEN prize_contribution_per_entry_vnd IS NULL THEN 'unknown'");
    expect(MIGRATION).toContain("capacity_state IN ('feasible','blocked','unknown')");
    expect(MIGRATION).toContain("collision_state IN ('clear','needs_review','blocked','unknown')");
  });

  it("keeps approved history immutable and revision lineage explicit", () => {
    expect(MIGRATION).toContain("series_v_candidate_immutable");
    expect(MIGRATION).toContain("idx_series_v_candidate_single_successor");
    expect(MIGRATION).toContain("supersedes_candidate_id");
    expect(MIGRATION).toContain("series_v_candidate_delete_forbidden");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.series_approve_schedule_candidate_v1");
    expect(MIGRATION).toContain("v_parent.source_fingerprint = v_fingerprint");
    expect(MIGRATION).toContain("COALESCE(v_parent.revision + 1, 1)");
  });

  it("uses an atomic idempotent actor and club limiter with bounded retention", () => {
    expect(MIGRATION).toContain("series_copilot_rate_limit_requests_v1");
    expect(MIGRATION).toContain("pg_catalog.pg_advisory_xact_lock");
    expect(MIGRATION).toContain("PRIMARY KEY (actor_id, club_id, request_id)");
    expect(MIGRATION).toContain("v_short_count < 5 AND v_long_count < 30");
    expect(MIGRATION).toContain("DELETE FROM public.series_copilot_rate_limit_requests_v1");
    expect(MIGRATION).toContain("WHERE expires_at <= v_now");
    expect(MIGRATION).toContain("IF v_allowed THEN");
    expect(MIGRATION).toContain("'limitScope', 'actor_club_global'");
  });

  it("pins SECURITY DEFINER search paths and denies anon and service role execution", () => {
    expect(MIGRATION.match(/SECURITY DEFINER\nSET search_path = ''/g)?.length).toBe(3);
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.series_get_approved_schedule_candidates_v1(uuid, text[])");
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.series_consume_copilot_rate_limit_v1(uuid, uuid)");
    expect(MIGRATION).toContain("FROM PUBLIC, anon, service_role");
  });
});
