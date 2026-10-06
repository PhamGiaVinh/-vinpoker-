import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(resolve(process.cwd(),
  "supabase/migrations/20270128000011_chip_ops_bank_adjust_integrity_v1.sql"), "utf8");
const archived = readFileSync(resolve(process.cwd(),
  "supabase/migration-archive/historical-never-replay/20261019000000_chip_ops_ledger_bank.sql"), "utf8");

describe("chip bank adjustment forward migration (source contract only)", () => {
  it("refuses to replace an unknown live function and pins definer resolution", () => {
    const start = archived.indexOf("CREATE OR REPLACE FUNCTION public.chip_ops_bank_adjust(");
    const bodyStart = archived.indexOf("AS $$", start) + 5;
    const bodyEnd = archived.indexOf("$$;", bodyStart);
    expect(start).toBeGreaterThanOrEqual(0);
    const reviewedBody = archived.slice(bodyStart, bodyEnd).replace(/\r\n?/g, "\n").replace(/\n/g, "\r\n");
    const digest = createHash("sha256").update(reviewedBody).digest("hex");
    expect(digest).toBe("c42675d1ef018ef928730963156d1935457faae8c6a1a1c846a0189d6f6ae523");
    expect(sql).toContain(digest);
    expect(sql).toContain("live body differs from reviewed precondition");
    expect(sql).toContain("SECURITY DEFINER SET search_path = ''");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE|DELETE)\s+(?:TABLE|FROM)\s+public\.chip_bank/iu);
  });

  it("binds the retry key to the original actor, club and immutable payload", () => {
    for (const clause of [
      "v_prior.reason IS DISTINCT FROM 'manual'",
      "v_prior.club_id IS DISTINCT FROM p_club_id",
      "v_prior.denomination_id IS DISTINCT FROM p_denomination_id",
      "v_prior.tournament_id IS DISTINCT FROM p_tournament_id",
      "v_prior.direction IS DISTINCT FROM p_direction",
      "v_prior.count IS DISTINCT FROM p_count",
      "v_prior.actor IS DISTINCT FROM v_uid",
      "'expected_version', p_old_version",
      "'IDEMPOTENCY_CONFLICT'",
    ]) expect(sql).toContain(clause);
  });

  it("rejects invalid CAS and cross-club tournament references before writing", () => {
    expect(sql).toContain("p_old_version IS NULL");
    expect(sql).toContain("p_idempotency_key IS NULL");
    expect(sql).toContain("COALESCE(public.is_club_owner(v_uid, p_club_id), false)");
    expect(sql).toContain("COALESCE(public.is_club_chip_master(v_uid, p_club_id), false)");
    expect(sql).toContain("t.id = p_tournament_id AND t.club_id = p_club_id AND t.deleted_at IS NULL");
    expect(sql).toContain("'TOURNAMENT_NOT_IN_CLUB'");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("'BANK_NEGATIVE'");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.chip_ops_bank_adjust");
    expect(sql).toContain("TO authenticated;");
  });
});
