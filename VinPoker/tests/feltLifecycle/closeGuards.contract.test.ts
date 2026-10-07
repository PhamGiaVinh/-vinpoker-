import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");
const migration = readFileSync(resolve(
  root, "supabase/migrations/20270128000012_felt_lifecycle_close_guards_v1.sql",
), "utf8");

describe("Felt lifecycle close guards migration contract", () => {
  it("guards both legacy tour archive and physical table deactivation", () => {
    expect(migration).toContain("BEFORE INSERT ON public.dealer_swing_archives");
    expect(migration).toContain("BEFORE UPDATE OF status, shift_id ON public.game_tables");
    expect(migration).toContain("s.closed_at IS NULL");
    expect(migration).toContain("tt.status = 'active'");
    expect(migration).toContain("move.status = 'pending'");
  });

  it("guards close-report insertion without blocking separate auto-finalization", () => {
    expect(migration).toContain("BEFORE INSERT ON public.tournament_close_report");
    expect(migration).not.toContain("BEFORE UPDATE OF status ON public.tournaments");
    expect(migration).toContain("assignment.released_at IS NULL");
    expect(migration).toContain("h.status = 'in_progress'");
  });

  it("only exposes authenticated, actor-scoped readiness RPCs", () => {
    expect(migration).toContain("public.get_dealer_tour_close_readiness_v1");
    expect(migration).toContain("public.get_tournament_close_readiness_v1");
    expect(migration).toContain("public.is_club_dealer_control(auth.uid(), p_club_id)");
    expect(migration).toContain("c.owner_id = auth.uid() OR cc.user_id IS NOT NULL");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.get_tournament_close_readiness_v1(uuid)");
    expect(migration).toContain("TO authenticated;");
  });
});
