import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyWriterInventory } from "./legacyWriterInventory";

const migrationsRoot = resolve(process.cwd(), "supabase", "migrations");
const pr2aMigration = readFileSync(
  resolve(migrationsRoot, "20270108000003_tracker_unified_ops_v2_context_safe_start.sql"),
  "utf8",
);

describe("Tracker PR2A legacy-writer inventory", () => {
  it("lists every required context-affecting writer exactly once", () => {
    const names = legacyWriterInventory.map((row) => row.writer);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual([
      "floor_set_table_control_mode",
      "floor_assign_player_to_seat",
      "move_player_seat",
      "close_tournament_table",
      "redraw_tournament",
      "floor_bust_player",
      "restore_busted_player_to_seat",
      "floor_update_tournament_seat_chip",
      "floor_start_tournament_clock",
      "floor_control_tournament_clock",
      "create_offline_buyin_and_seat",
      "reenter_tournament_player",
    ]);
  });

  it("points every row at an existing current-main migration", () => {
    for (const row of legacyWriterInventory) {
      expect(existsSync(resolve(migrationsRoot, row.sourceMigration))).toBe(true);
      expect(row.signature).toContain(`${row.writer}(`);
    }
  });

  it("does not claim runtime certification without exact writer bodies", () => {
    expect(
      legacyWriterInventory.every((row) =>
        [
          "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
          "INCOMPATIBLE_ADVISORY_LOCK_ORDER",
        ].includes(row.runtimeStatus),
      ),
    ).toBe(true);
    expect(
      legacyWriterInventory.some(
        (row) => row.runtimeStatus === "WRITER_BODY_NOT_FAITHFULLY_REPRODUCED",
      ),
    ).toBe(true);
  });

  it("records the confirmed V2/legacy advisory lock incompatibility", () => {
    const mode = readFileSync(
      resolve(migrationsRoot, "20270105000001_floor_table_control_mode.sql"),
      "utf8",
    );
    const close = readFileSync(
      resolve(migrationsRoot, "20270106000003_close_table_canonical_contract.sql"),
      "utf8",
    );

    expect(pr2aMigration).toContain(
      "hashtextextended('tracker-unified-ops:' || p_tournament_id::TEXT, 0)",
    );
    expect(mode).toContain("hashtext(p_tournament_id::text)");
    expect(close).toContain("hashtext(v_tour.id::text)");
    expect(mode.indexOf("FOR UPDATE")).toBeLessThan(
      mode.indexOf("PERFORM pg_advisory_xact_lock"),
    );
    expect(close.indexOf("FOR UPDATE")).toBeLessThan(
      close.indexOf("PERFORM pg_advisory_xact_lock"),
    );
  });
});
