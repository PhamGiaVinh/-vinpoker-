import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const hotfixName = "20270112000004_tracker_record_action_authority_binding.sql";
const voiceMigrationName = "20270112000003_tracker_voice_player_analytics_v0.sql";
const hotfix = readFileSync(resolve(root, "supabase/migrations", hotfixName), "utf8");
const voiceMigration = readFileSync(resolve(root, "supabase/migrations", voiceMigrationName), "utf8");
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");
const consoleHook = readFileSync(
  resolve(root, "src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/tracker-record-action-authority-hotfix-db.yml"),
  "utf8",
);

function functionBody(source: string, functionName: string, terminator: string): string {
  const start = source.indexOf(`FUNCTION public.${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(terminator, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + terminator.length);
}

describe("Tracker record_action authority hotfix", () => {
  it("uses the unique next migration version", () => {
    const names = readdirSync(resolve(root, "supabase/migrations"))
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();
    expect(names.filter((name) => name.startsWith("20270112000004_"))).toEqual([hotfixName]);
    expect(names.at(-1)).toBe(hotfixName);
  });

  it("keeps the current-schema writer as a security invoker with auth-bound strict locking", () => {
    const recordAction = functionBody(hotfix, "record_action", "$body$;");
    expect(recordAction).toContain("SECURITY INVOKER");
    expect(recordAction).toContain("v_actor UUID := auth.uid()");
    expect(recordAction).toContain("actor_mismatch");
    expect(recordAction).toContain("FOR UPDATE OF h");
    for (const code of [
      "tracker_lock_required",
      "tracker_lock_expired",
      "tracker_lock_owned_by_another",
      "tracker_lock_ambiguous",
    ]) {
      expect(recordAction).toContain(code);
    }
    expect(recordAction).not.toContain("tracker_lock_blocks");
    expect(recordAction).not.toContain("UPDATE public.tournament_hands");
  });

  it("binds the dedicated heartbeat claim to auth.uid and keeps browser grants narrow", () => {
    const heartbeat = functionBody(hotfix, "heartbeat_lock", "$body$;");
    expect(heartbeat).toContain("SECURITY DEFINER");
    expect(heartbeat).toContain("SET search_path = public");
    expect(heartbeat).toContain("v_actor UUID := auth.uid()");
    expect(heartbeat).toContain("actor_mismatch");
    expect(heartbeat).toContain("tracker_lock_owned_by_another");
    expect(heartbeat).not.toContain("updated_at = now()");
    expect(hotfix).toContain("REVOKE ALL ON FUNCTION public.heartbeat_lock(UUID, UUID) FROM PUBLIC, anon, service_role;");
    expect(hotfix).toContain("GRANT EXECUTE ON FUNCTION public.heartbeat_lock(UUID, UUID) TO authenticated;");
    expect(hotfix).toContain("REVOKE ALL ON FUNCTION public.record_action(");
  });

  it("prevents the future Voice migration from restoring implicit record_action lock writes", () => {
    const recordAction = functionBody(voiceMigration, "record_action", "$function$;");
    expect(recordAction).toContain("v_actor UUID := auth.uid()");
    expect(recordAction).toContain("actor_mismatch");
    expect(recordAction).toContain("FOR UPDATE OF h");
    expect(recordAction).toContain("tracker_lock_required");
    expect(recordAction).not.toContain("tracker_lock_blocks");
    expect(recordAction).not.toContain("UPDATE public.tournament_hands");
    expect(voiceMigration).toContain("CREATE OR REPLACE FUNCTION public.heartbeat_lock(");
    expect(voiceMigration).toContain("_tracker_voice_assignment_context");
    expect(voiceMigration).not.toContain("'locked_by_user_id', h.locked_by_user_id");
    expect(voiceMigration).not.toContain("'locked_at', h.locked_at");
    expect(voiceMigration).not.toContain("'lock_version', COALESCE(h.tracker_lock_version, 0)");
  });

  it("keeps the Edge JWT caller contract and propagates a canonical denial as non-success", () => {
    expect(edge).toContain("headers: { Authorization: authHeader }");
    expect(edge).toContain("supabase.auth.getUser()");
    expect(edge).toContain("p_user_id: user.id");
    expect(edge).toContain('if (action === "record_action" && result.data && typeof result.data === "object")');
    expect(edge).toContain("status: 409");
  });

  it("claims immediately before the standalone console enables a started or resumed hand", () => {
    const startClaim = consoleHook.indexOf("await claimHandLock(handData.hand_id)");
    const startEnabled = consoleHook.indexOf("setHandStarted(true)", startClaim);
    const resumeClaim = consoleHook.indexOf("await claimHandLock(hand.id)");
    const resumeEnabled = consoleHook.indexOf("setHandStarted(true)", resumeClaim);
    expect(startClaim).toBeGreaterThanOrEqual(0);
    expect(startClaim).toBeLessThan(startEnabled);
    expect(resumeClaim).toBeGreaterThanOrEqual(0);
    expect(resumeClaim).toBeLessThan(resumeEnabled);
    expect(consoleHook).toContain("resolveHandLockClaim(data, error, user.id)");
    expect(consoleHook).toContain("setActionSyncBlocked(true);\n            setIsReadOnly(true);");
  });

  it("keeps the disposable proof local and source-only", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain(hotfixName);
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
    expect(workflow).not.toContain("orlesggcjamwuknxwcpk");
    expect(workflow).not.toMatch(/SUPABASE_(URL|KEY|SERVICE_ROLE_KEY)/i);
  });
});
