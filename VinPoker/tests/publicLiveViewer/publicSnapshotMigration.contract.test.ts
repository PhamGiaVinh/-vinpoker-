import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const migration = readFileSync(
  resolve(root, "supabase/migrations/20270111000002_public_tournament_event_snapshot.sql"),
  "utf8",
);
const workflow = readFileSync(
  resolve(root, "../.github/workflows/public-live-viewer-v2-disposable-db.yml"),
  "utf8",
);

describe("Public Tournament Live Viewer V2 database contract", () => {
  it("exposes one sanitized anonymous read seam with least-privilege grants", () => {
    expect(migration).toMatch(
      /CREATE OR REPLACE FUNCTION public\.get_public_tournament_event_snapshot\(\s*p_tournament_id uuid\s*\)/,
    );
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toMatch(
      /REVOKE ALL ON FUNCTION public\.get_public_tournament_event_snapshot\(uuid\)[\s\S]*FROM PUBLIC, anon, authenticated, service_role/,
    );
    expect(migration).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.get_public_tournament_event_snapshot\(uuid\)[\s\S]*TO anon, authenticated, service_role/,
    );
    expect(migration).not.toMatch(/GRANT\s+SELECT\s+ON/i);
  });

  it("returns physical table identity and display-only seat fields", () => {
    expect(migration).toContain("tt.table_id AS table_identity");
    expect(migration).toContain("'id', tt.table_id");
    expect(migration).toContain("'seatNumber', s.seat_number");
    expect(migration).toContain("'playerName', NULLIF(btrim(s.player_name), '')");
    expect(migration).toContain("'chipCount', s.chip_count");
    expect(migration).toContain("'avatarUrl', s.avatar_url");
    expect(migration).not.toMatch(/'player_?id'\s*,/i);
    expect(migration).not.toMatch(/'entry_?id'\s*,/i);
  });

  it("keeps the disposable proof secret-free and production-independent", () => {
    expect(workflow).toContain("image: postgres:17");
    expect(workflow).toContain("ON_ERROR_STOP=1");
    expect(workflow).toContain("20270111000002_public_tournament_event_snapshot.sql");
    expect(workflow).toContain("tests/publicLiveViewer/disposableDb.integration.sql");
    expect(workflow).not.toContain("SUPABASE_");
    expect(workflow).not.toContain("db push");
    expect(workflow).not.toContain("functions deploy");
  });
});
