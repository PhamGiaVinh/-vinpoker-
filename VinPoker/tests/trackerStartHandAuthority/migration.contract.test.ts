import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrationDirectory = resolve(root, "supabase/migrations");
const hotfixName = "20270112000005_tracker_start_hand_authority_binding.sql";
const normalizeSql = (source: string) => source.replace(/\r\n/g, "\n");
const hotfix = normalizeSql(readFileSync(resolve(migrationDirectory, hotfixName), "utf8"));
const edge = readFileSync(resolve(root, "supabase/functions/tournament-live-update/index.ts"), "utf8");

function functionBody(functionName: string): string {
  const start = hotfix.indexOf(`FUNCTION public.${functionName}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = hotfix.indexOf("$function$;", start);
  expect(end).toBeGreaterThan(start);
  return hotfix.slice(start, end + "$function$;".length);
}

function migrationDefinesStartHand(migration: string): boolean {
  return migration.includes("FUNCTION public.start_hand(");
}

function startHandDefinition(migration: string): string {
  const start = migration.indexOf("FUNCTION public.start_hand(");
  expect(start).toBeGreaterThanOrEqual(0);

  const terminator = ["$function$;", "$body$;", "$definition$;"]
    .map((value) => ({ value, index: migration.indexOf(value, start) }))
    .filter(({ index }) => index >= 0)
    .sort((left, right) => left.index - right.index)
    .at(0);

  expect(terminator).toBeDefined();
  return migration.slice(start, terminator!.index + terminator!.value.length);
}

function expectAuthBoundStartHandDefinition(definition: string, migration: string): void {
  expect(definition).toContain("p_created_by uuid DEFAULT NULL::uuid");
  expect(definition).toContain("SECURITY INVOKER");
  expect(definition).toContain("SET search_path = public");
  expect(definition).toContain("v_actor_user_id UUID := auth.uid()");
  expect(definition).toContain("IF v_actor_user_id IS NULL THEN");
  expect(definition).toContain("'error', 'unauthenticated'");
  expect(definition).toContain("p_created_by IS NOT NULL AND p_created_by <> v_actor_user_id");
  expect(definition).toContain("'error', 'actor_mismatch'");
  expect(definition).toContain("public.is_club_tracker(v_actor_user_id, v_tt.club_id)");
  expect(definition).toContain("v_actor_user_id, v_actor_user_id, NOW(), p_button_seat");
  expect(definition).not.toContain("p_created_by, p_created_by, NOW()");
  expect(migration).toContain(
    "REVOKE ALL ON FUNCTION public.start_hand(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, INTEGER)",
  );
  expect(migration).toContain(
    "GRANT EXECUTE ON FUNCTION public.start_hand(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, INTEGER)\n  TO authenticated;",
  );
}

describe("Tracker start_hand authority hotfix", () => {
  it("keeps the final start_hand definition auth-bound without coupling the guard to unrelated later migrations", () => {
    const migrations = readdirSync(migrationDirectory)
      .filter((name) => /^\d{14}_.+\.sql$/.test(name))
      .sort();

    expect(migrations.filter((name) => name.startsWith("20270112000005_"))).toEqual([hotfixName]);

    const laterStartMigrations = migrations
      .filter((name) => name > hotfixName)
      .map((name) => ({ name, sql: normalizeSql(readFileSync(resolve(migrationDirectory, name), "utf8")) }))
      .filter(({ sql }) => migrationDefinesStartHand(sql));

    // A future migration may legitimately sort after the P0 hotfix. It only
    // becomes unsafe when it replaces start_hand without preserving the reviewed
    // auth.uid(), ABI, role, and ACL contract.
    for (const { sql } of laterStartMigrations) {
      expectAuthBoundStartHandDefinition(startHandDefinition(sql), sql);
    }

    expectAuthBoundStartHandDefinition(functionBody("start_hand"), hotfix);
  });

  it("binds start ownership and audit identity to auth.uid while preserving the six-argument ABI", () => {
    const startHand = functionBody("start_hand");
    expect(startHand).toContain("p_created_by uuid DEFAULT NULL::uuid");
    expect(startHand).toContain("SECURITY INVOKER");
    expect(startHand).toContain("SET search_path = public");
    expect(startHand).toContain("v_actor_user_id UUID := auth.uid()");
    expect(startHand).toContain("'error', 'unauthenticated'");
    expect(startHand).toContain("'error', 'actor_mismatch'");
    expect(startHand).toContain("public.is_club_tracker(v_actor_user_id, v_tt.club_id)");
    expect(startHand).toContain("v_actor_user_id, v_actor_user_id, NOW(), p_button_seat");
    expect(startHand).not.toContain("p_created_by, p_created_by, NOW()");
    expect(hotfix).toContain("REVOKE ALL ON FUNCTION public.start_hand(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, INTEGER)");
    expect(hotfix).toContain("GRANT EXECUTE ON FUNCTION public.start_hand(UUID, UUID, INTEGER, TIMESTAMPTZ, UUID, INTEGER)\n  TO authenticated;");
  });

  it("binds every legacy action writer that refreshes a hand lock to auth.uid", () => {
    for (const name of ["update_community_cards", "show_hole_cards", "delete_last_action"]) {
      const writer = functionBody(name);
      expect(writer).toContain("SECURITY INVOKER");
      expect(writer).toContain("SET search_path = public");
      expect(writer).toContain("v_actor UUID := auth.uid()");
      expect(writer).toContain("'error', 'actor_mismatch'");
      expect(writer).toContain("public.is_club_tracker(v_actor, v_hand.club_id)");
      expect(writer).toContain("tracker_lock_owned_by_another");
      expect(writer).not.toContain("tracker_lock_blocks");
    }

    for (const signature of [
      "update_community_cards(UUID, JSONB, UUID)",
      "show_hole_cards(UUID, JSONB, UUID)",
      "delete_last_action(UUID, UUID)",
    ]) {
      expect(hotfix).toContain(`REVOKE ALL ON FUNCTION public.${signature}`);
      expect(hotfix).toContain(`GRANT EXECUTE ON FUNCTION public.${signature}`);
    }
  });

  it("keeps heartbeat auth-bound without overwriting the reviewed Voice-aware implementation", () => {
    expect(hotfix).toContain("IF to_regclass('public.tracker_voice_events') IS NULL THEN");
    expect(hotfix).toContain("v_actor UUID := auth.uid()");
    expect(hotfix).toContain("tracker authority hotfix requires the Voice-era auth-bound heartbeat_lock definition");
    expect(hotfix).toContain("REVOKE ALL ON FUNCTION public.heartbeat_lock(UUID, UUID)");
    expect(hotfix).toContain("GRANT EXECUTE ON FUNCTION public.heartbeat_lock(UUID, UUID)\n  TO authenticated;");
  });

  it("preserves the authenticated Edge caller contract rather than trusting frontend identity", () => {
    expect(edge).toContain("headers: { Authorization: authHeader }");
    expect(edge).toContain("supabase.auth.getUser()");
    expect(edge).toContain("p_created_by: user.id");
  });
});
