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
const completionMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270115000020_tracker_history_completion_queue.sql"),
  "utf8",
);
const worker = readFileSync(
  resolve(process.cwd(), "supabase/functions/tournament-historical-settlement-worker/index.ts"),
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
    expect(edge).toContain("commit_tracker_historical_display_outcome_v2");
    expect(edge).toContain("stale_historical_preview");
  });

  it("queues revisions idempotently and claims with a bounded fencing lease", () => {
    expect(completionMigration).toContain("CREATE TABLE IF NOT EXISTS public.tracker_historical_display_queue");
    expect(completionMigration).toContain("PRIMARY KEY (hand_id, source_revision)");
    expect(completionMigration).toContain("ON CONFLICT (hand_id, source_revision)");
    expect(completionMigration).toContain("h.source_revision = q.source_revision");
    expect(completionMigration).not.toContain("ON CONFLICT (hand_id) DO UPDATE");
    expect(completionMigration).toContain("FOR UPDATE SKIP LOCKED");
    expect(completionMigration).toContain("lease_token = gen_random_uuid()");
    expect(completionMigration).toContain("lease_until > now()");
    expect(completionMigration).toContain("tracker_enqueue_historical_display");
    expect(completionMigration).toContain("tracker_small_blind");
    expect(completionMigration).toContain("tracker_big_blind");
    expect(completionMigration).toContain("tracker_blind_evidence");
    expect(completionMigration).toContain("correct_tracker_historical_hand_blinds");
    expect(completionMigration).toContain("tracker_hand_blind_correction_audit");
    expect(completionMigration).toContain("settlement_revision");
    expect(completionMigration).toContain("v_next_revision");
  });

  it("keeps the worker service-only, dark by default, and on the existing verifier", () => {
    expect(worker).toContain('TRACKER_HISTORY_COMPLETION_WORKER_ENABLED');
    expect(worker).toContain('verifyHistoricalDisplaySettlement');
    expect(worker).toContain('claim_tracker_historical_display_jobs');
    expect(worker).toContain('commit_tracker_historical_display_outcome_v2');
    expect(worker).toContain('p_actor_kind: "system_worker"');
    expect(worker).toContain('p_lease_token: job.lease_token');
    expect(worker).not.toContain('winner_id');
  });

  it("uses the existing public projector without exposing its historical proof metadata", () => {
    expect(publicSettlementReader).toContain("CREATE OR REPLACE FUNCTION public.get_public_tournament_settlement");
    expect(publicSettlementReader).toContain("AND o.source_revision = h.source_revision");
    expect(publicSettlementReader).toContain("- 'sourceChainHash'");
    expect(publicSettlementReader).toContain("- 'outcomeHash'");
    expect(publicSettlementReader).not.toContain("verification_scope = 'chain'");
  });

  it("returns only verified historical results for the matching hand revision", () => {
    expect(completionMigration).toContain("AND o.verification_scope = 'historical_display'");
    expect(completionMigration).toContain("AND o.source_revision = p.source_revision");
    expect(completionMigration).toContain("'status','pending'");
    expect(completionMigration).toContain("interval '10 seconds'");
    expect(completionMigration).toContain("'netDelta'");
    expect(completionMigration).toContain("'potKinds'");
  });
});
