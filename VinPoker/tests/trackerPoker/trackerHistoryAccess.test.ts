import { describe, expect, it } from "vitest";
import { archiveTournamentClubScope } from "@/lib/tracker-poker/trackerHistoryAccess";

describe("Tracker Hand Archive tournament scope", () => {
  it("does not narrow a super-admin to incidental tracker memberships", () => {
    expect(archiveTournamentClubScope({ isAdmin: true, trackerClubIds: ["club-a"] })).toBeNull();
  });

  it("keeps tracker-only and club-owner discovery scoped to their resolved clubs", () => {
    expect(archiveTournamentClubScope({ isAdmin: false, trackerClubIds: ["club-a"] })).toEqual(["club-a"]);
    expect(archiveTournamentClubScope({ isAdmin: false, trackerClubIds: [] })).toEqual([]);
  });
});
