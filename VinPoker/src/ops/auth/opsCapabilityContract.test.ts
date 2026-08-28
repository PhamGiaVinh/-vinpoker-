import { describe, expect, it } from "vitest";
import {
  OpsCapabilityContractError,
  parseOpsCapabilityScope,
  parseOpsGlobalCapability,
  parseOpsSuperAdminClubs,
} from "./opsCapabilityContract";

const clubId = "10000000-0000-4000-8000-000000000001";
const legacyPostgresClubId = "10000000-0000-0000-0000-000000000001";
const validRow = {
  club_id: clubId,
  can_owner: false,
  can_floor: true,
  can_cashier: false,
  can_tracker: true,
  can_dealer_control: false,
  can_accountant: false,
  can_chip_master: false,
  can_marketer: false,
  can_fnb_cashier: true,
  can_fnb_server: false,
  can_fnb_kitchen: true,
};

describe("Ops V3 capability contract", () => {
  it("accepts a complete multi-role row without collapsing F&B facets", () => {
    expect(parseOpsCapabilityScope([validRow])).toEqual([validRow]);
  });

  it("accepts a canonical PostgreSQL UUID without an RFC version or variant", () => {
    expect(parseOpsCapabilityScope([{ ...validRow, club_id: legacyPostgresClubId }])).toEqual([
      { ...validRow, club_id: legacyPostgresClubId },
    ]);
  });

  it.each([
    ["non-array", null],
    ["missing field", [{ ...validRow, can_floor: undefined }]],
    ["non-boolean", [{ ...validRow, can_floor: 1 }]],
    ["invalid club", [{ ...validRow, club_id: "club-a" }]],
    ["unexpected actor field", [{ ...validRow, user_id: clubId }]],
    ["duplicate club", [validRow, { ...validRow }]],
  ])("fails closed for %s", (_label, value) => {
    expect(() => parseOpsCapabilityScope(value)).toThrow(OpsCapabilityContractError);
  });

  it("requires exactly one strict global capability row", () => {
    expect(parseOpsGlobalCapability([{ is_super_admin: true }])).toEqual({ is_super_admin: true });
    expect(() => parseOpsGlobalCapability([])).toThrow(OpsCapabilityContractError);
    expect(() => parseOpsGlobalCapability([{ is_super_admin: false, clubs: [] }])).toThrow(
      OpsCapabilityContractError,
    );
  });

  it("validates the bounded super-admin club page contract", () => {
    expect(parseOpsSuperAdminClubs([{ club_id: clubId, club_name: "HSOP" }])).toEqual([
      { club_id: clubId, club_name: "HSOP" },
    ]);
    expect(
      parseOpsSuperAdminClubs([{ club_id: legacyPostgresClubId, club_name: "Legacy club" }]),
    ).toEqual([{ club_id: legacyPostgresClubId, club_name: "Legacy club" }]);
    expect(() =>
      parseOpsSuperAdminClubs([
        { club_id: clubId, club_name: "HSOP" },
        { club_id: clubId, club_name: "Duplicate" },
      ]),
    ).toThrow(OpsCapabilityContractError);
  });
});
