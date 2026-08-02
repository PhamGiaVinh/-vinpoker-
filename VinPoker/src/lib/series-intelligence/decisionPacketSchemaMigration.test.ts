import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(HERE, "../../..");
const MIGRATIONS_DIR = join(APP_ROOT, "supabase", "migrations");
const MIGRATION_FILE = "20270107000001_series_decision_packet_v1.sql";
const SQL = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), "utf8");
const NORMALIZED = SQL.replace(/\s+/g, " ").toLowerCase();
const EXECUTABLE = SQL.replace(/--.*$/gm, "").replace(/\s+/g, " ").toLowerCase();

function expectContains(...fragments: string[]) {
  for (const fragment of fragments) expect(NORMALIZED).toContain(fragment);
}

describe("D2A decision packet source migration", () => {
  it("uses a unique coordinated migration version", () => {
    const files = readdirSync(MIGRATIONS_DIR).filter((name) => /^\d{14}_.+\.sql$/.test(name));
    expect(files).toContain(MIGRATION_FILE);
    expect(files.filter((name) => name.startsWith("20270107000001_"))).toEqual([MIGRATION_FILE]);
  });

  it("is additive and leaves every legacy Series Intelligence table untouched", () => {
    expectContains(
      "create table if not exists public.series_decision_packets_v1",
      "create table if not exists public.series_event_actual_revisions_v1",
    );
    for (const legacy of [
      "series_decision_logs",
      "series_event_actuals",
      "series_registration_events",
      "series_forecast_snapshots",
    ]) {
      expect(NORMALIZED).not.toMatch(new RegExp(`\\b(update|delete\\s+from|alter\\s+table)\\s+public\\.${legacy}\\b`));
    }
    expect(EXECUTABLE).not.toMatch(/\b(drop|truncate)\s+table\b/);
  });

  it("uses RESTRICT references for packet and actual audit history", () => {
    expectContains(
      "references public.clubs(id) on delete restrict",
      "references public.tournaments(id) on delete restrict",
      "references public.series_forecast_snapshots(id) on delete restrict",
      "references public.series_decision_packets_v1( id, club_id, event_id, decision_horizon ) on delete restrict",
      "references public.series_event_actual_revisions_v1( id, club_id, event_id, outcome_scope ) on delete restrict",
    );
    expect(NORMALIZED).not.toContain("on delete cascade");
    expect(NORMALIZED).not.toContain("on delete set null");
  });

  it("locks packet identity, single-root, and linear supersession", () => {
    expectContains(
      "sdp_v1_identity_unique unique (id, club_id, event_id, decision_horizon)",
      "create unique index if not exists idx_sdp_v1_root_unique",
      "where supersedes_packet_id is null",
      "create unique index if not exists idx_sdp_v1_single_successor",
      "where supersedes_packet_id is not null",
      "series_decision_packet_identity_immutable",
      "series_decision_packet_freeze_must_not_change_content",
      "series_decision_packet_frozen",
      "series_decision_packet_delete_forbidden",
    );
  });

  it("keeps packet outcome/PII data outside the information set", () => {
    for (const forbidden of [
      "'actual_entries'",
      "'actual_unique_players'",
      "'actual_prize_pool'",
      "'final_entries'",
      "'paid_places'",
      "'payouts'",
      "'player_id'",
      "'phone'",
      "'email'",
    ]) {
      expect(NORMALIZED).toContain(forbidden);
    }
    expectContains(
      "not public._series_jsonb_has_forbidden_packet_key_v1(known_information)",
      "decision_packet_outcome_or_pii_leakage",
    );
  });

  it("derives club, actor, target event, and content hashes on the server", () => {
    expectContains(
      "v_actor uuid := auth.uid()",
      "select * into v_event from public.tournaments where id = p_event_id and deleted_at is null",
      "p_target_event_ts is distinct from v_event.start_time",
      "public._series_sha256_jsonb_v1",
      "public._series_decision_packet_content_hash_v1",
      "frozen_at = pg_catalog.now()",
      "frozen_by = v_actor",
    );
  });

  it("checks exact forecast event/timing/eligibility when freezing", () => {
    expectContains(
      "if p_forecast_snapshot_id is not null then",
      "or p_target_metric <> 'entries'",
      "v_snapshot.provenance_completeness is distinct from 'missing_code_sha'",
      "forecast_not_identity_eligible",
      "v_snapshot.club_id <> v_packet.club_id",
      "v_snapshot.event_id <> v_packet.event_id",
      "v_snapshot.target_event_ts is distinct from v_packet.target_event_ts",
      "v_snapshot.forecast_issued_at > v_packet.as_of_ts",
      "v_snapshot.as_of_ts > v_snapshot.forecast_issued_at",
      "v_snapshot.forecast_issued_at > v_packet.target_event_ts",
      "v_snapshot.forecast_identity_eligible is distinct from true",
    );
  });

  it("fails closed for closed packet targets and unsupported final actuals", () => {
    expectContains(
      "v_event.status::text in ('finished','completed','cancelled')",
      "decision_packet_event_already_closed",
      "decision_packet_event_not_freezable",
      "p_as_of_ts > pg_catalog.now()",
      "v_packet.as_of_ts > v_packet.created_at",
      "p_finality in ('final','corrected')",
      "v_event.status::text not in ('finished','completed')",
      "event_actual_finality_not_supported_by_event_state",
      "p_source_timestamp < v_event.start_time",
      "event_actual_final_published_before_event",
    );
  });

  it("models scope, finality, source, and publication semantics explicitly", () => {
    expectContains(
      "outcome_scope in ('event_total','flight_only','day_total','series_total','partial_result','unknown')",
      "finality in ('partial','provisional','final','corrected','conflicting','void')",
      "'native_tournament_system','auto_capture','owner_manual','reconciled'",
      "source_timestamp_state = 'exact'",
      "source_timestamp <= captured_at",
      "source_timestamp_state = 'not_reported' and source_timestamp is null",
    );
  });

  it("keeps missing and explicit zero separate for every metric", () => {
    expectContains(
      "when p_availability = 'present' then p_value is not null and p_value > 0",
      "when p_availability = 'explicit_zero' then p_value = 0",
      "when p_availability in ('missing','uncertain','conflicting','not_applicable') then p_value is null",
      "when p_availability = 'explicit_zero' then p_amount_minor = 0",
    );
    for (const metric of [
      "entries",
      "unique",
      "bullets",
      "reentries",
      "registration_records",
      "paid_places",
      "prize_pool",
      "overlay",
    ]) {
      expect(NORMALIZED).toContain(`sear_v1_${metric}_chk`);
    }
  });

  it("does not derive reentries and only enforces compatible inequalities", () => {
    expectContains(
      "unique_players_value <= entries_value",
      "unique_players_value <= total_bullets_value",
      "reentries_value <= total_bullets_value",
      "paid_places_value <= entries_value",
    );
    expect(NORMALIZED).not.toMatch(/reentries_value\s*=\s*entries_value\s*-\s*unique_players_value/);
  });

  it("uses append-only actual history with one successor and explicit reconciliation links", () => {
    expectContains(
      "create unique index if not exists idx_sear_v1_single_successor",
      "series_event_actual_revision_is_append_only",
      "reconciles_auto_revision_id",
      "reconciles_manual_revision_id",
      "reconciliation_status",
      "finality not in ('corrected','void') or supersedes_revision_id is not null",
    );
  });

  it("exposes owner reads but no direct authenticated write grants", () => {
    expectContains(
      "revoke all on table public.series_decision_packets_v1 from public, anon, authenticated",
      "grant select on table public.series_decision_packets_v1 to authenticated",
      "revoke all on table public.series_event_actual_revisions_v1 from public, anon, authenticated",
      "grant select on table public.series_event_actual_revisions_v1 to authenticated",
      "create policy sdp_v1_owner_select",
      "create policy sear_v1_owner_select",
    );
    expect(NORMALIZED).not.toMatch(/grant\s+(insert|update|delete|all)[^;]+to authenticated/);
    expect(NORMALIZED).not.toMatch(/grant\s+(insert|update|delete|all)[^;]+to service_role/);
  });

  it("pins every SECURITY DEFINER function to an empty search_path", () => {
    const functionBlocks = SQL
      .split(/CREATE OR REPLACE FUNCTION/i)
      .slice(1)
      .filter((block) => /SECURITY DEFINER/i.test(block));
    expect(functionBlocks.length).toBeGreaterThanOrEqual(3);
    for (const block of functionBlocks) {
      expect(block).toMatch(/SET search_path = ''/i);
    }
    expectContains(
      "revoke all on function public.series_create_decision_packet_v1",
      "revoke all on function public.series_freeze_decision_packet_v1",
      "revoke all on function public.series_record_event_actual_v1",
      "grant execute on function public.series_create_decision_packet_v1",
      "grant execute on function public.series_freeze_decision_packet_v1",
      "grant execute on function public.series_record_event_actual_v1",
    );
  });

  it("uses owner-scoped idempotency and transaction locks for contested writes", () => {
    expectContains(
      "create unique index if not exists idx_sdp_v1_idempotency on public.series_decision_packets_v1(club_id, idempotency_key)",
      "create unique index if not exists idx_sear_v1_idempotency on public.series_event_actual_revisions_v1(club_id, idempotency_key)",
      "request_hash text not null",
      "v_existing.request_hash <> v_request_hash",
      "decision-packet-idempotency:",
      "decision-packet-root:",
      "event-actual-idempotency:",
      "event-actual-lineage:",
      "pg_catalog.pg_advisory_xact_lock",
      "decision_packet_idempotency_conflict",
      "event_actual_idempotency_conflict",
    );
  });

  it("contains no DB apply, Edge, feature flag, or generated-type mutation", () => {
    expect(EXECUTABLE).not.toContain("supabase db push");
    expect(EXECUTABLE).not.toContain("functions deploy");
    expect(EXECUTABLE).not.toContain("seriesdecisionpacketv1");
    expect(EXECUTABLE).not.toContain("src/integrations/supabase/types.ts");
  });
});
