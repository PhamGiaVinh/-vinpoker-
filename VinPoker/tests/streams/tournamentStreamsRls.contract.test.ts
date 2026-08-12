import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270110000009_tournament_streams_owner_write_policy.sql"),
  "utf8",
);
const streamLinkManager = readFileSync(resolve(process.cwd(), "src/components/admin/StreamLinkManager.tsx"), "utf8");
const adminStreamManager = readFileSync(resolve(process.cwd(), "src/components/admin/AdminStreamManager.tsx"), "utf8");

describe("tournament_streams owner write policy", () => {
  it("restores only authenticated insert, update, and delete policies", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "Admin or club owner manage streams"');
    expect(migration).toMatch(/CREATE POLICY "Tournament stream managers insert"[\s\S]*FOR INSERT[\s\S]*TO authenticated/);
    expect(migration).toMatch(/CREATE POLICY "Tournament stream managers update"[\s\S]*FOR UPDATE[\s\S]*TO authenticated/);
    expect(migration).toMatch(/CREATE POLICY "Tournament stream managers delete"[\s\S]*FOR DELETE[\s\S]*TO authenticated/);
    expect(migration).not.toMatch(/FOR ALL/);
    expect(migration).not.toMatch(/TO\s+(?:anon|public)/i);
  });

  it("requires a super-admin or ownership of the stream tournament for every write", () => {
    const writePolicies = migration.slice(migration.indexOf('CREATE POLICY "Tournament stream managers insert"'));

    expect(writePolicies.match(/public\.has_role\(\(select auth\.uid\(\)\), 'super_admin'::public\.app_role\)/g)).toHaveLength(4);
    expect(writePolicies.match(/tournament\.id = tournament_streams\.tournament_id/g)).toHaveLength(4);
    expect(writePolicies.match(/club\.owner_id = \(select auth\.uid\(\)\)/g)).toHaveLength(4);
  });

  it("checks both the old and replacement tournament scope for an update", () => {
    const updatePolicy = migration.slice(
      migration.indexOf('CREATE POLICY "Tournament stream managers update"'),
      migration.indexOf('CREATE POLICY "Tournament stream managers delete"'),
    );

    expect(updatePolicy).toContain("USING (");
    expect(updatePolicy).toContain("WITH CHECK (");
  });

  it("makes created_by server-owned and immutable", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.enforce_tournament_stream_creator()");
    expect(migration).toContain("NEW.created_by := auth.uid();");
    expect(migration).toContain("NEW.created_by IS DISTINCT FROM OLD.created_by");
    expect(migration).toContain("ERRCODE = '42501'");
    expect(migration).toContain("CREATE TRIGGER trg_tournament_streams_creator_guard");
  });

  it("does not alter existing rows, public read access, or RLS enablement", () => {
    expect(migration).not.toMatch(/(?:INSERT\s+INTO|UPDATE\s+public\.tournament_streams|DELETE\s+FROM)/i);
    expect(migration).not.toMatch(/(?:DISABLE|ENABLE)\s+ROW LEVEL SECURITY/i);
  });

  it("does not send a browser-controlled creator and rejects zero-row mutations", () => {
    expect(streamLinkManager).not.toMatch(/created_by\s*:/);
    expect(adminStreamManager).not.toMatch(/created_by\s*:/);
    expect(streamLinkManager.match(/\.select\("id"\)/g)).toHaveLength(3);
    expect(adminStreamManager.match(/\.select\("id"\)/g)).toHaveLength(4);
    expect(streamLinkManager).toContain("changedExactlyOneStream(data)");
    expect(adminStreamManager).toContain("changedExactlyOneStream(data)");
  });
});
