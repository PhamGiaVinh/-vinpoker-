import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const migration = read("supabase/migrations/20270115000017_tracker_completed_hand_correction_uat.sql");
const edge = read("supabase/functions/tournament-live-resettle-commit/index.ts");
const workspace = read("src/components/cashier/tournament-live/HandHistoryWorkspace.tsx");

describe("Tracker correction Release 3 latest-hand UAT contract", () => {
  it("keeps completed-hand correction exact-scope and disabled by default", () => {
    expect(migration).toContain("capability = 'correct_completed_hand'");
    expect(migration).toContain("scope_row.user_id = v_actor");
    expect(migration).toContain("scope_row.tournament_table_id = v_hand.tournament_table_id");
    expect(migration).not.toMatch(/INSERT INTO public\.tracker_correction_uat_scopes/i);
  });

  it("fails closed when history has progressed beyond the target hand", () => {
    expect(migration).toContain("'later_hand_scope_not_supported'");
    expect(migration).toContain("'active_hand_blocks_resettle'");
  });

  it("requires a server preview fingerprint before commit", () => {
    expect(edge).toContain('mode !== "preview" && mode !== "commit"');
    expect(edge).toContain('return publicFailure(req, "stale_correction_preview")');
    expect(edge).toContain('authorize_tracker_completed_hand_correction_uat_v1');
    expect(workspace).toContain('mode: "preview"');
    expect(workspace).toContain('expected_source_chain_hash: rv.serverPreview.sourceChainHash');
    expect(workspace).toContain('idempotency_key: rv.idempotencyKey');
  });

  it("keeps draft readiness authoritative at the Edge boundary", () => {
    expect(edge).toContain('draft_status: "READY_TO_APPLY"');
    expect(edge).toContain('computeFailureDraftStatus(error)');
    expect(workspace).toContain('preview.draft_status !== "READY_TO_APPLY"');
  });
});
