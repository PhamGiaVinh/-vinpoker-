import { describe, expect, it } from "vitest";
import { mergeClubRows, normalizeClubIds } from "../dealerControlAccess";

describe("dealerControlAccess", () => {
  it("normalizes string and PostgREST object rows and removes duplicates", () => {
    expect(normalizeClubIds([
      "club-a",
      { dealer_control_club_ids: "club-b" },
      { dealer_control_club_ids: "club-a" },
      null,
      { unexpected: "club-c" },
    ], "dealer_control_club_ids")).toEqual(["club-a", "club-b"]);
  });

  it("keeps authorized IDs when the club display query is incomplete", () => {
    expect(mergeClubRows(
      ["club-a", "club-b"],
      [{ id: "club-a", name: "HSOP" }],
    )).toEqual([
      { id: "club-a", name: "HSOP" },
      { id: "club-b", name: "CLB club-b" },
    ]);
  });
});
