import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const migrationName = "20270110000002_hand_players_identity_columns_forward_fix.sql";
const migration = readFileSync(resolve(migrationsDir, migrationName), "utf8");

describe("Tracker hand-player identity forward repair", () => {
  it("uses one unique version after its required predecessor", () => {
    const versions = readdirSync(migrationsDir)
      .map((name) => /^([0-9]{14})_/.exec(name)?.[1])
      .filter((version): version is string => Boolean(version));
    const version = migrationName.slice(0, 14);

    expect(versions.filter((candidate) => candidate === version)).toHaveLength(1);
    expect(Number(version)).toBeGreaterThan(Number("20270110000001"));
  });

  it("adds only the two nullable identity columns", () => {
    expect(migration).toContain("ALTER TABLE public.hand_players");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS player_name text");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS avatar_url text");
    expect(migration.match(/ADD COLUMN IF NOT EXISTS/g)).toHaveLength(2);
  });

  it("does not replace runtime code or mutate existing data", () => {
    expect(migration).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
    expect(migration).not.toMatch(/\b(?:GRANT|REVOKE)\b/i);
    expect(migration).not.toMatch(/CREATE\s+TRIGGER/i);
  });
});
