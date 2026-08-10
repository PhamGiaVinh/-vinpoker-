import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270110000007_tracker_historical_settlement_display.sql"),
  "utf8",
);
const edge = readFileSync(
  resolve(process.cwd(), "supabase/functions/tournament-historical-settlement/index.ts"),
  "utf8",
);
const publicSettlementReader = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20261238000002_tracker_settlement_outcome_store.sql"),
  "utf8",
);

describe("historical settlement display migration contract", () => {
  it("keeps historical display verification target-only and non-mutating", () => {
    expect(migration).toContain("verification_scope IN ('chain', 'historical_display')");
    expect(migration).toContain("get_tournament_historical_display_source_hash");
    expect(migration).toContain("settled_hand.id = changed_hand.id");
    expect(migration).toContain("INSERT INTO public.tournament_settlement_outcomes");
    expect(migration).not.toContain("UPDATE public.hand_players SET");
    expect(migration).not.toContain("UPDATE public.tournament_chip_counts");
    expect(migration).not.toContain("UPDATE public.tournament_seats");
    expect(migration).not.toContain("UPDATE public.tournament_entries");
  });

  it("requires a service-only, owner/admin checked, CAS-bound receipt", () => {
    expect(migration).toContain("service_role_only");
    expect(migration).toContain("public.is_club_owner(p_actor_user_id, v_tournament.club_id)");
    expect(migration).toContain("public.is_club_admin(p_actor_user_id, v_tournament.club_id)");
    expect(migration).toContain("FOR UPDATE;");
    expect(migration).toContain("stale_source_revision");
    expect(migration).toContain("idempotency_mismatch");
    expect(migration).toContain("historical_settlement_already_exists");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.commit_historical_tournament_settlement_display_outcome");
    expect(migration).toContain("TO service_role");
  });

  it("rejects private public-outcome fields recursively", () => {
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

  it("keeps the Edge function intent-only and recomputes before a single write RPC", () => {
    expect(edge).toContain("mode?: \"preview\" | \"commit\"");
    expect(edge).not.toContain("winner_id");
    expect(edge).not.toContain("p_ending_stack");
    expect(edge).toContain("verifyHistoricalDisplaySettlement");
    expect(edge).toContain("authorize_tournament_live_resettle");
    expect(edge).toContain("commit_historical_tournament_settlement_display_outcome");
    expect(edge).toContain("stale_historical_preview");
  });

  it("uses the existing public projector without exposing its historical proof metadata", () => {
    expect(publicSettlementReader).toContain("CREATE OR REPLACE FUNCTION public.get_public_tournament_settlement");
    expect(publicSettlementReader).toContain("AND o.source_revision = h.source_revision");
    expect(publicSettlementReader).toContain("- 'sourceChainHash'");
    expect(publicSettlementReader).toContain("- 'outcomeHash'");
    expect(publicSettlementReader).not.toContain("verification_scope = 'chain'");
  });
});
