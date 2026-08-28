import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { legacyWriterInventory } from "./legacyWriterInventory";

const migrationsRoot = resolve(process.cwd(), "supabase", "migrations");
const archiveRoot = resolve(process.cwd(), "supabase", "migration-archive");
function resolveMigrationSource(filename: string) {
  const activePath = resolve(migrationsRoot, filename);
  if (existsSync(activePath)) return activePath;

  const pending = [archiveRoot];
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.name === filename) {
        return entryPath;
      }
    }
  }
  return activePath;
}
const pr2aMigration = readFileSync(
  resolve(migrationsRoot, "20270108000003_tracker_unified_ops_v2_context_safe_start.sql"),
  "utf8",
);
const containmentMigration = readFileSync(
  resolveMigrationSource("20270108000004_tracker_unified_ops_writer_lock_containment.sql"),
  "utf8",
);
const remainingWriterIntegration = readFileSync(
  resolve(
    process.cwd(),
    "tests/trackerUnifiedOps/legacyWriterClose.integration.sql",
  ),
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
      expect(existsSync(resolveMigrationSource(row.sourceMigration))).toBe(true);
      expect(row.signature).toContain(`${row.writer}(`);
    }
  });

  it("records exact body reproduction and the measured/unmeasured runtime boundary", () => {
    const measured = new Set([
      "floor_set_table_control_mode",
      "floor_assign_player_to_seat",
      "move_player_seat",
      "close_tournament_table",
      "redraw_tournament",
      "floor_bust_player",
      "floor_update_tournament_seat_chip",
      "floor_start_tournament_clock",
      "floor_control_tournament_clock",
      "create_offline_buyin_and_seat",
    ]);

    for (const writer of legacyWriterInventory) {
      const start = containmentMigration.indexOf(
        `CREATE OR REPLACE FUNCTION public.${writer.writer}(`,
      );
      expect(start, writer.writer).toBeGreaterThanOrEqual(0);
      const end = containmentMigration.indexOf(
        "\nCREATE OR REPLACE FUNCTION public.",
        start + 1,
      );
      const block = containmentMigration.slice(
        start,
        end === -1 ? undefined : end,
      );
      expect(block, writer.writer).toContain(
        "tracker_unified_ops_lock_tournament",
      );
      expect(
        block.indexOf("tracker_unified_ops_lock_tournament"),
        writer.writer,
      ).toBeLessThan(block.indexOf("FOR UPDATE"));
    }

    for (const writer of measured) {
      expect(
        legacyWriterInventory.find((row) => row.writer === writer)?.runtimeStatus,
      ).toBe("FIXED_BY_SHARED_TOURNAMENT_LOCK");
    }
    expect(
      legacyWriterInventory
        .filter(
          (row) =>
            row.runtimeStatus === "RUNTIME_NOT_MEASURED_IDENTITY_DEPENDENCIES",
        )
        .map((row) => row.writer),
    ).toEqual(["restore_busted_player_to_seat", "reenter_tournament_player"]);
    expect(remainingWriterIntegration).toContain("REMAINING_WRITER_RACE_PASS");
    expect(remainingWriterIntegration).toContain(
      "RESTORE_REENTRY_NOT_MEASURED_IDENTITY_DEPENDENCIES",
    );
  });

  it("records the confirmed V2/legacy advisory lock incompatibility", () => {
    const closeRow = legacyWriterInventory.find(
      (row) => row.writer === "close_tournament_table",
    );
    const mode = readFileSync(
      resolveMigrationSource("20270105000004_floor_table_control_mode.sql"),
      "utf8",
    );
    const close = readFileSync(
      resolveMigrationSource("20270106000003_close_table_canonical_contract.sql"),
      "utf8",
    );
    const containment = readFileSync(
      resolveMigrationSource("20270108000004_tracker_unified_ops_writer_lock_containment.sql"),
      "utf8",
    );

    expect(pr2aMigration).toContain(
      "hashtextextended('tracker-unified-ops:' || p_tournament_id::TEXT, 0)",
    );
    expect(mode).toContain("hashtext(p_tournament_id::text)");
    expect(close).toContain("hashtext(v_tour.id::text)");
    expect(containment).toContain(
      "PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);",
    );
    expect(closeRow?.runtimeStatus).toBe("FIXED_BY_SHARED_TOURNAMENT_LOCK");
    expect(containment).toContain(
      "PERFORM public.tracker_unified_ops_lock_tournament(v_lock_tournament_id);",
    );
    expect(containment.indexOf("tracker_unified_ops_lock_tournament(p_tournament_id)")).toBeLessThan(
      containment.indexOf("FOR UPDATE"),
    );
    expect(mode.indexOf("FOR UPDATE")).toBeLessThan(
      mode.indexOf("PERFORM pg_advisory_xact_lock"),
    );
    expect(close.indexOf("FOR UPDATE")).toBeLessThan(
      close.indexOf("PERFORM pg_advisory_xact_lock"),
    );
  });
});
