import { describe, expect, it } from "vitest";
import { selectOwnerDailyDigestClub } from "@/ops/digest/ownerDailyDigestClubSelection";

const clubs = [
  { id: "20000000-0000-0000-0000-000000000001", name: "CLB Một" },
  { id: "20000000-0000-0000-0000-000000000002", name: "CLB Hai" },
] as const;

describe("Owner Daily Digest club deep links", () => {
  it("uses the first accessible club only when the URL does not request a club", () => {
    expect(selectOwnerDailyDigestClub(clubs, null)).toEqual(clubs[0]);
  });

  it("uses the explicitly requested accessible club", () => {
    expect(selectOwnerDailyDigestClub(clubs, clubs[1].id)).toEqual(clubs[1]);
  });

  it.each([
    "00000000-0000-0000-0000-000000000000",
    "not-a-club-id",
    "",
  ])("does not fall back when a requested club is outside the server scope: %s", (clubId) => {
    expect(selectOwnerDailyDigestClub(clubs, clubId)).toBeNull();
  });
});
