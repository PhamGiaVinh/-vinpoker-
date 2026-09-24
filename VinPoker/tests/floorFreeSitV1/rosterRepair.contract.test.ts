import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repair = readFileSync(
  resolve(process.cwd(), "supabase/pending-migrations/20270115000005_floor_roster_actions_repair.sql"),
  "utf8",
);

describe("Floor V3 roster repair migration", () => {
  it("leaves the V3 bust entry transition to the atomic V3 writer", () => {
    expect(repair).toContain("CREATE OR REPLACE FUNCTION public.floor_bust_sync_entry()");
    expect(repair).toContain("IF NEW.tournament_table_id IS NOT NULL AND NEW.table_session_id IS NOT NULL THEN");
    expect(repair).toContain("RETURN NULL;");
    expect(repair).toContain("WHERE id = NEW.entry_id AND status = 'seated'");
    expect(repair).toContain("SET search_path = ''");
  });

  it("allows the inactive Free Sit state without weakening active-seat uniqueness", () => {
    expect(repair).toContain("'active', 'moved', 'busted', 'cancelled', 'free_sit'");
    expect(repair).toMatch(/ALTER TABLE public\.tournament_seats\s+DROP CONSTRAINT IF EXISTS tournament_seats_status_check,\s+ADD CONSTRAINT tournament_seats_status_check/);
    expect(repair).not.toMatch(/DROP\s+INDEX/i);
    expect(repair).not.toMatch(/UPDATE\s+public\.tournament_seats/i);
  });
});
