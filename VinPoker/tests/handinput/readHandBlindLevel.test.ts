import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ row: {} as Record<string, unknown> }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fixture.row, error: null }) }) }) }),
} }));
import { readHandBlindLevel } from "@/lib/tournament/readBlindLineage";
describe("canonical frozen blind level", () => {
  beforeEach(() => { fixture.row = { tracker_level_number: 1, tracker_small_blind: 100, tracker_big_blind: 100, tracker_bba: 0 }; });
  it("accepts Floor's positive equal-blind opening level", async () => {
    await expect(readHandBlindLevel("hand")).resolves.toEqual({ level_number: 1, small_blind: 100, big_blind: 100, ante: 0 });
  });
  it.each([{ tracker_small_blind: 0 }, { tracker_big_blind: 99 }, { tracker_bba: -1 }, { tracker_big_blind: 100.5 }])("rejects invalid evidence %j", async (invalid) => {
    Object.assign(fixture.row, invalid);
    await expect(readHandBlindLevel("hand")).rejects.toThrow("tracker_hand_blind_snapshot_invalid");
  });
});
