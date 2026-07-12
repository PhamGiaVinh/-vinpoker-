import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const migration = readFileSync(resolve(process.cwd(), "supabase/migrations/20261238000002_tracker_settlement_outcome_store.sql"), "utf8");
const edge = readFileSync(resolve(process.cwd(), "supabase/functions/tournament-live-resettle/index.ts"), "utf8");

describe("Tracker settlement migration contract", () => {
  it("keeps the verified outcome write boundary service-role-only", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tournament_settlement_outcomes");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.commit_tournament_settlement_outcome");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.commit_tournament_settlement_outcome");
    expect(migration).toContain("service_role_only");
    expect(migration).toContain("stale_source_revision");
    expect(migration).toContain("idempotency_mismatch");
    expect(migration).toContain("o.tournament_id = v_hand.tournament_id AND o.idempotency_key = p_idempotency_key");
    expect(migration).toContain("v_existing.hand_id <> p_hand_id");
  });

  it("keeps public projection separate from private settlement evidence", () => {
    expect(migration).toContain("get_public_tournament_settlement");
    expect(migration).toContain("private_field_in_public_outcome");
    expect(migration).toContain("p_public_outcome->'pots'");
    expect(migration).toContain("p_public_outcome->'players'");
    expect(migration).toContain("- 'sourceChainHash'");
    expect(migration).toContain("- 'outcomeHash'");
  });

  it("rejects every recursively-forbidden public field at the database boundary", () => {
    for (const field of [
      "privateEvidence",
      "holeCards",
      "holeCardsByPlayer",
      "muckedHoleCardsByPlayer",
      "externalAdjustments",
      "evaluatorInput",
      "correctionNotes",
      "staffIdentity",
      "actor",
    ]) {
      expect(migration).toContain(`jsonb_path_exists(p_public_outcome, '$.**.${field}')`);
    }
  });

  it("matches the live jsonb card columns instead of assigning text arrays", () => {
    expect(migration).toContain("SET community_cards = p_edit->'community_cards'");
    expect(migration).toContain("SET hole_cards = v_item->'hole_cards'");
    expect(migration).not.toContain("ARRAY(SELECT jsonb_array_elements_text(p_edit->'community_cards'))");
    expect(migration).not.toContain("ARRAY(SELECT jsonb_array_elements_text(v_item->'hole_cards'))");
  });

  it("ships the authorization dependency used by the preview Edge route", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.authorize_tournament_live_resettle");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.authorize_tournament_live_resettle(uuid) TO authenticated, service_role");
  });

  it("locks and hashes every settlement input that affects ordering", () => {
    expect(migration).toContain("BEFORE UPDATE OF button_seat, community_cards");
    expect(migration).toContain("'source_revision', h.source_revision");
    expect(migration).toContain("'button_seat', h.button_seat");
    expect(migration).toContain("AND h.hand_number >= v_hand.hand_number");
    expect(migration).toContain("ORDER BY h.hand_number, h.id");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("tracker_mark_prior_settlements_stale");
  });

  it("does not depend on the later Live Center migration objects", () => {
    expect(migration).not.toMatch(/snapshot_hand_player_identity|get_public_tournament_clock_summary|bust_tournament_player_with_payout/);
  });

  it("keeps the legacy Edge route preview-only", () => {
    expect(edge).toContain("LEGACY_COMMIT_DISABLED");
    expect(edge).not.toContain("commit_tournament_settlement_outcome");
    expect(edge).toContain("normalizeSettlementSourceRpcResult(source)");
  });
});
