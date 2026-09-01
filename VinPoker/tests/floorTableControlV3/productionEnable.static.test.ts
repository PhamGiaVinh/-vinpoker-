import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20270113000012_floor_table_control_v3_production_enable.sql"),
  "utf8",
);
const productionWorkflow = readFileSync(
  resolve(process.cwd(), "../.github/workflows/vbackerworkflowmain.yml"),
  "utf8",
);

const writers = [
  "floor_open_tournament_table_v3(uuid, uuid, text, uuid)",
  "operator_open_club_tables_v2(uuid[], text, uuid)",
  "operator_close_club_table_v2(uuid, bigint, uuid)",
  "validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint)",
  "floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid)",
  "floor_set_table_control_mode_v3(uuid, text, bigint, uuid)",
  "move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid)",
  "close_tournament_table_v3(uuid, bigint, uuid)",
  "floor_break_table_v3(uuid, bigint, uuid, text)",
  "floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text)",
  "floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid)",
] as const;

describe("Floor Table Control V3 Production enable migration", () => {
  it("grants only the exact eleven caller-bound writers to authenticated", () => {
    for (const signature of writers) {
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, service_role;`,
      );
      expect(migration).toContain(
        `GRANT EXECUTE ON FUNCTION public.${signature} TO authenticated;`,
      );
      expect(migration).toContain(
        `REVOKE ALL ON FUNCTION public.${signature} FROM authenticated;`,
      );
    }

    expect((migration.match(/GRANT EXECUTE ON FUNCTION public\./gu) ?? [])).toHaveLength(11);
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|USAGE)\b/iu);
  });

  it("contains no data, RLS, trigger, or function-body mutation", () => {
    expect(migration).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|ALTER\s+TABLE|CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION|CREATE\s+TRIGGER|DROP\s+)\b/iu);
  });

  it("builds the production bundle from Vercel environment without hardcoding the enable pair", () => {
    expect(productionWorkflow).toContain(
      "vercel env run --environment=production -- npm run build",
    );
    expect(productionWorkflow).not.toContain("VITE_FLOOR_TABLE_CONTROL_V3: production");
    expect(productionWorkflow).not.toContain("VITE_FLOOR_UAT_ENV: production");
  });
});
