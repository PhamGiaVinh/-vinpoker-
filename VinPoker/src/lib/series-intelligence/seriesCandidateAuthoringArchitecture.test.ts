import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const source = (path: string) => readFileSync(join(ROOT, path), "utf8");
const MIGRATION = source("supabase/migrations/20270111000000_series_v_candidate_authoring_v1.sql");
const STATUS_COMPATIBILITY_MIGRATION = source("supabase/migrations/20270112000001_series_v_candidate_authoring_source_state_compatibility.sql");
const LIVE_REGISTRATION_COMPATIBILITY_MIGRATION = source("supabase/migrations/20270112000002_series_v_candidate_authoring_live_registration_compatibility.sql");
const ADAPTER = source("src/lib/series-intelligence/seriesCandidateAuthoringRpc.ts");
const PANEL = source("src/components/series-intelligence/SeriesCandidateAuthoringPanel.tsx");
const PAGE = source("src/pages/SeriesIntelligence.tsx");
const FLAGS = source("src/lib/featureFlags.ts");

describe("Series V Candidate Authoring V1 boundaries", () => {
  it("enables the owner workflow for Preview UAT and keeps it outside demo Pulse mode", () => {
    expect(FLAGS).toMatch(/seriesVCandidateAuthoringV1:\s*true/);
    expect(PAGE).toContain("FEATURES.seriesVCandidateAuthoringV1 && !clubPulseDemoMode");
    expect(PAGE).toContain("<SeriesCandidateAuthoringPanel clubId={liveClubPulse?.clubId ?? null} />");
  });

  it("uses server-anchored preview and approval RPCs without direct candidate table writes", () => {
    expect(ADAPTER).toContain('approveFromTournament: "series_approve_schedule_candidate_from_tournament_v1"');
    expect(ADAPTER).toContain('preview: "series_preview_schedule_candidate_v1"');
    expect(ADAPTER).toContain('approvedReadback: "series_get_approved_schedule_candidates_v1"');
    expect(ADAPTER).not.toContain('series_approve_schedule_candidate_v1"');
    expect(ADAPTER).not.toMatch(/\.from\(["']series_schedule_candidates_v1["']\)/);
    expect(PANEL).not.toContain("askSeriesCopilotEdgeV1");
    expect(PANEL).toContain("candidate versioned");
  });

  it("keeps the original owner-scoped source contract and a server-built evidence manifest", () => {
    expect(MIGRATION).toContain("public.is_club_owner(v_actor, p_club_id)");
    expect(MIGRATION).toContain("t.status = 'scheduled'");
    expect(MIGRATION).toContain("t.start_time > v_as_of");
    expect(MIGRATION).toContain("v_tournament.start_time <= v_now");
    expect(MIGRATION).toContain("FROM public.tournaments AS t");
    expect(MIGRATION).toContain("'sourceId', 'tournaments'");
    expect(MIGRATION).toContain("'sourceId', 'series_v_candidate_authoring'");
    expect(MIGRATION).toContain("'tournament:' || v_tournament.id::text");
  });

  it("accepts only future pre-live statuses supported by the tournament state machine", () => {
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("t.status IN ('active', 'upcoming', 'registering')");
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("t.start_time > v_as_of");
    expect(STATUS_COMPATIBILITY_MIGRATION.match(/v_tournament\.status = ANY \(ARRAY\['active'::text, 'upcoming'::text, 'registering'::text\]\)/g)?.length).toBe(2);
    expect(STATUS_COMPATIBILITY_MIGRATION).not.toContain("t.status = 'scheduled'");
    expect(STATUS_COMPATIBILITY_MIGRATION).not.toMatch(/['"]live['"]/);
  });

  it("admits only pre-start live tournaments whose registration is still open", () => {
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("t.status = 'live'");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("t.live_status = 'registering'");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("t.clock_started_at IS NULL");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("t.registration_closed_at IS NULL");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION.match(/v_tournament\.status = 'live'/g)?.length).toBe(2);
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION.match(/v_tournament\.live_status = 'registering'/g)?.length).toBe(2);
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION.match(/v_tournament\.clock_started_at IS NULL/g)?.length).toBe(2);
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION.match(/v_tournament\.registration_closed_at IS NULL/g)?.length).toBe(2);
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("t.start_time > v_as_of");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("v_tournament.start_time <= v_now");
  });

  it("preserves owner authorization and hardened definer grants in the live-registration replacement", () => {
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION.match(/CREATE OR REPLACE FUNCTION public\.series_(?:list_schedule_candidate_sources|preview_schedule_candidate|approve_schedule_candidate_from_tournament)_v1/g)?.length).toBe(3);
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION.match(/SECURITY DEFINER\r?\nSET search_path = ''/g)?.length).toBe(3);
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("public.is_club_owner(v_actor, p_club_id)");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("REVOKE ALL ON FUNCTION public.series_approve_schedule_candidate_from_tournament_v1");
    expect(LIVE_REGISTRATION_COMPATIBILITY_MIGRATION).toContain("FROM PUBLIC, anon, service_role");
  });

  it("preserves the authoring security and source-evidence boundary while replacing the RPC bodies", () => {
    expect(STATUS_COMPATIBILITY_MIGRATION.match(/CREATE OR REPLACE FUNCTION public\.series_(?:list_schedule_candidate_sources|preview_schedule_candidate|approve_schedule_candidate_from_tournament)_v1/g)?.length).toBe(3);
    expect(STATUS_COMPATIBILITY_MIGRATION.match(/SECURITY DEFINER\r?\nSET search_path = ''/g)?.length).toBe(3);
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("public.is_club_owner(v_actor, p_club_id)");
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("'sourceId', 'tournaments'");
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("'sourceId', 'series_v_candidate_authoring'");
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("REVOKE ALL ON FUNCTION public.series_approve_schedule_candidate_from_tournament_v1");
    expect(STATUS_COMPATIBILITY_MIGRATION).toContain("FROM PUBLIC, anon, service_role");
  });

  it("bounds the source query before aggregation and keeps an idempotent source timestamp", () => {
    expect(MIGRATION).toMatch(/FROM \(\r?\n {4}SELECT t\.id, t\.name, t\.start_time/);
    expect(MIGRATION).toMatch(/LIMIT 50\r?\n {2}\) AS t;/);
    expect(MIGRATION).toContain("COALESCE(v_tournament.updated_at, v_tournament.created_at)");
    expect(MIGRATION).not.toContain("'asOf', pg_catalog.to_char(v_now");
  });

  it("does not infer prize contribution or expose unaudited privileges", () => {
    expect(MIGRATION).not.toMatch(/buy_in\s*[-+*/]\s*(?:rake_amount|service_fee_amount)/i);
    expect(MIGRATION).not.toMatch(/GRANT\s+(?:INSERT|UPDATE|DELETE|ALL)\s+ON\s+TABLE\s+public\.series_schedule_candidates_v1/i);
    expect(MIGRATION).toContain("p_prize_contribution_per_entry_vnd");
    expect(MIGRATION.match(/SECURITY DEFINER\r?\nSET search_path = ''/g)?.length).toBe(3);
    expect(MIGRATION).toContain("REVOKE ALL ON FUNCTION public.series_approve_schedule_candidate_from_tournament_v1");
    expect(MIGRATION).toContain("FROM PUBLIC, anon, service_role");
  });

  it("binds a pre-existing schedule GTD and verifies exactly one current candidate after approval", () => {
    expect(MIGRATION).toContain("series_v_candidate_gtd_mismatch");
    expect(ADAPTER).toContain("matching.length !== 1");
    expect(ADAPTER).toContain("readback_mismatch");
    expect(PANEL).toContain("Server đã xác nhận phương án đã duyệt");
  });
});
