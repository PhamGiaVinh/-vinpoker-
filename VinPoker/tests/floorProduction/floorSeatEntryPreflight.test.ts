import { describe, expect, it } from "vitest";
import {
  preflightFloorSeatEntry,
  preflightFloorTableEntries,
} from "@/components/ops/shared/floorSeatEntryPreflight";

describe("Floor entry preflight", () => {
  it("allows only an active seat with an entry link", () => {
    expect(preflightFloorSeatEntry({ id: "seat-a", is_active: true, entry_id: "entry-a" }))
      .toEqual({ ok: true, entryId: "entry-a" });
    expect(preflightFloorSeatEntry({ id: "seat-a", is_active: true, entry_id: null }))
      .toEqual({ ok: false, error: "orphan_active_seat" });
    expect(preflightFloorSeatEntry({ id: "seat-a", is_active: false, entry_id: "entry-a" }))
      .toEqual({ ok: false, error: "seat_not_active" });
  });

  it("blocks a table close when any rendered active seat is missing or orphaned", () => {
    expect(preflightFloorTableEntries(
      ["seat-a", "seat-b", "seat-c"],
      [
        { id: "seat-a", is_active: true, entry_id: "entry-a" },
        { id: "seat-b", is_active: true, entry_id: null },
      ],
    )).toEqual({ ok: false, error: "orphan_active_seat", blockedSeatCount: 2 });
  });
});
