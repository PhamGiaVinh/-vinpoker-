import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDir = resolve(process.cwd(), "supabase/migrations");
const containmentFilename = "20270101000000_close_tournament_table_containment.sql";
const migrationPath = resolve(migrationsDir, containmentFilename);
const sql = readFileSync(migrationPath, "utf8");

function closeTableDefinitionsInFilenameOrder(): string[] {
  return readdirSync(migrationsDir)
    .filter((filename) => /^\d{14}_.*\.sql$/.test(filename))
    .sort()
    .filter((filename) => /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.close_tournament_table/i.test(
      readFileSync(resolve(migrationsDir, filename), "utf8"),
    ));
}

describe("close_tournament_table containment migration contract", () => {
  it("locks the source table, tournament, and active-seat snapshot before any write", () => {
    expect(sql).toMatch(/FROM public\.tournament_tables tt[\s\S]*?FOR UPDATE;/);
    expect(sql).toMatch(/FROM public\.tournaments[\s\S]*?FOR UPDATE;/);
    expect(sql).toMatch(/FROM public\.tournament_seats ts[\s\S]*?AND ts\.is_active = true[\s\S]*?FOR UPDATE;/);
  });

  it("fails closed for unlinked active seats before creating movers or mutating seats", () => {
    const mismatch = sql.indexOf("'UNLINKED_ACTIVE_SEATS'");
    const movers = sql.indexOf("CREATE TEMP TABLE tmp_movers");
    expect(mismatch).toBeGreaterThan(-1);
    expect(movers).toBeGreaterThan(mismatch);
    expect(sql).toContain("v_total_active_seats > 0 AND v_unlinked_active_seats > 0");
    expect(sql).toContain("'active_chip_total', v_active_chip_total");
  });

  it("allows the empty branch only for zero active seats and has no bulk seat-deactivate fallback", () => {
    expect(sql).toContain("IF v_total_active_seats = 0 THEN");
    expect(sql).not.toMatch(/UPDATE public\.tournament_seats\s+SET is_active = false\s+WHERE tournament_id/s);
  });

  it("checks mover identity, unchanged seats, and chip/count conservation before closing the table", () => {
    const closeTable = sql.lastIndexOf("UPDATE public.tournament_tables");
    expect(sql.indexOf("close_table_conservation_failed")).toBeLessThan(closeTable);
    expect(sql.indexOf("mover_identity_not_conserved")).toBeLessThan(closeTable);
    expect(sql.indexOf("other_active_seat_changed")).toBeLessThan(closeTable);
    expect(sql).toContain("source_table_still_has_active_seats");
  });

  it("keeps containment as the final close-table definition in filename replay order", () => {
    const definitions = closeTableDefinitionsInFilenameOrder();
    expect(definitions).toContain("20260914000000_close_tournament_table.sql");
    expect(definitions.at(-1)).toBe(containmentFilename);
    expect(sql).toContain("'UNLINKED_ACTIVE_SEATS'");
  });
});
