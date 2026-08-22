import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationDirectory = resolve(root, "supabase/migrations");
const migrationName = "20270112000007_tracker_p0_authority_closure.sql";
const migration = readFileSync(resolve(migrationDirectory, migrationName), "utf8");
const consoleHook = readFileSync(
  resolve(root, "src/components/cashier/tournament-live/handinput/useStandaloneHandInput.ts"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/tracker-takeover-authority-closure-db.yml"),
  "utf8",
);

function takeoverBody(): string {
  const start = migration.indexOf("FUNCTION public.takeover_hand_lock(");
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + "$function$;".length);
}

describe("Tracker takeover lock P0 authority closure", () => {
  it("uses the next unique migration version and is the final takeover definition", () => {
    const migrations = readdirSync(migrationDirectory)
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();

    expect(migrations.filter((name) => name.startsWith("20270112000007_"))).toEqual([migrationName]);
    expect(migrations.filter((name) => name > migrationName && readFileSync(resolve(migrationDirectory, name), "utf8").includes("FUNCTION public.takeover_hand_lock("))).toEqual([]);
  });

  it("derives every lock owner from auth.uid while retaining the browser ABI", () => {
    const body = takeoverBody();
    expect(body).toContain("SECURITY DEFINER");
    expect(body).toContain("SET search_path = public");
    expect(body).toContain("v_actor uuid := auth.uid()");
    expect(body).toContain("IF v_actor IS NULL");
    expect(body).toContain("p_actor_user_id IS NOT NULL AND p_actor_user_id IS DISTINCT FROM v_actor");
    expect(body).toContain("'error', 'actor_mismatch'");
    expect(body).toContain("SET locked_by_user_id = v_actor");
    expect(body).not.toContain("SET locked_by_user_id = p_actor_user_id");
    expect(consoleHook).toContain('supabase.rpc("takeover_hand_lock" as any');
    expect(consoleHook).toContain("p_actor_user_id: user.id");
  });

  it("enforces role, club, hand-state, and stale-lock boundaries before mutation", () => {
    const body = takeoverBody();
    expect(body).toContain("FOR UPDATE OF h");
    expect(body).toContain("public.is_club_tracker(v_actor, v_club_id)");
    expect(body).toContain("public.is_club_floor(v_actor, v_club_id)");
    expect(body).toContain("COALESCE(v_is_voided, false)");
    expect(body).toContain("force_requires_floor");
    expect(body).toContain("public.tracker_lock_blocks(v_locked_by, v_locked_at, v_actor)");
    expect(body).toContain("lock_fresh");
    expect(body).not.toMatch(/hand_actions|chip_counts|tournament_seats|tournament_entries/i);
  });

  it("makes execution authenticated-only and keeps the local proof source-only", () => {
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role;");
    expect(migration).toContain("TO authenticated;");
    expect(migration).toContain("BEGIN;");
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain(migrationName);
    expect(workflow).not.toMatch(/--linked|db push|migration repair|functions deploy|vercel --prod/i);
    expect(workflow).not.toContain("orlesggcjamwuknxwcpk");
  });
});
