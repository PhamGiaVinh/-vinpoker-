import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationDirectory = resolve(root, "supabase/migrations");
const migrationName = "20270112000006_tracker_terminal_hand_rpc_authority.sql";
// Git stores the migration with LF, while Windows working trees can materialize
// CRLF. The contract is about SQL tokens, not checkout line endings.
const migration = readFileSync(resolve(migrationDirectory, migrationName), "utf8").replace(/\r\n/g, "\n");
const updateEdge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");
const cleanupEdge = readFileSync(resolve(root, "supabase/functions/tournament-live-cleanup/index.ts"), "utf8");

function functionBody(functionName: string): string {
  const start = migration.indexOf(`FUNCTION public.${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + "$function$;".length);
}

describe("Tracker terminal hand RPC authority hotfix", () => {
  it("uses the unique next version and remains final for the hardened terminal writers", () => {
    const migrations = readdirSync(migrationDirectory)
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();

    expect(migrations.filter((name) => name.startsWith("20270112000006_"))).toEqual([migrationName]);

    for (const functionName of ["void_last_hand", "cleanup_orphan_hands"]) {
      const laterDefinitions = migrations
        .filter((name) => name > migrationName)
        .filter((name) => readFileSync(resolve(migrationDirectory, name), "utf8").includes(`FUNCTION public.${functionName}(`));
      expect(laterDefinitions).toEqual([]);
    }
  });

  it("binds void_last_hand to the authenticated tracker identity before terminal writes", () => {
    const voidLastHand = functionBody("void_last_hand");
    expect(voidLastHand).toContain("SECURITY DEFINER");
    expect(voidLastHand).toContain("SET search_path TO 'public'");
    expect(voidLastHand).toContain("v_actor UUID := auth.uid()");
    expect(voidLastHand).toContain("public.is_club_tracker(v_actor, v_club_id)");
    expect(voidLastHand).toContain("public.is_club_owner(v_actor, v_club_id)");
    expect(voidLastHand).toContain("lock_owned_by_other");
    expect(voidLastHand).toContain("FOR UPDATE");
    expect(voidLastHand).not.toContain("p_actor");
  });

  it("bounds orphan cleanup and scopes every affected hand to tracker authority", () => {
    const cleanup = functionBody("cleanup_orphan_hands");
    expect(cleanup).toContain("SECURITY DEFINER");
    expect(cleanup).toContain("SET search_path TO 'public'");
    expect(cleanup).toContain("v_actor UUID := auth.uid()");
    expect(cleanup).toContain("INTERVAL '10 minutes'");
    expect(cleanup).toContain("INTERVAL '60 minutes'");
    expect(cleanup).toContain("invalid_cleanup_window");
    expect(cleanup).toContain("public.is_club_tracker(v_actor, t.club_id)");
    expect(cleanup).toContain("h.locked_by_user_id = v_actor");
    expect(cleanup).toContain("public.is_club_owner(v_actor, t.club_id)");
  });

  it("removes anonymous and legacy undo execution without adding a second action writer", () => {
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.undo_last_action(UUID)\n  FROM PUBLIC, anon, authenticated, service_role;");
    for (const signature of ["void_last_hand(UUID)", "cleanup_orphan_hands(INTERVAL)"]) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${signature}`);
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${signature}`);
    }
    expect(updateEdge).toContain('supabase.rpc("void_last_hand", { p_hand_id: hand_id })');
    expect(cleanupEdge).toContain('supabase.rpc("cleanup_orphan_hands"');
    expect(updateEdge).not.toContain('rpc("undo_last_action"');
    expect(cleanupEdge).not.toContain('rpc("undo_last_action"');
  });

  it("is an atomic forward migration", () => {
    expect(migration.trimStart().startsWith("--")).toBe(true);
    expect(migration).toContain("BEGIN;");
    expect(migration.trimEnd().endsWith("COMMIT;")).toBe(true);
  });
});
