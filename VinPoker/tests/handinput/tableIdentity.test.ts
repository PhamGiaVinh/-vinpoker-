import { describe, expect, it } from "vitest";

import { resolveTournamentTableId } from "@/components/cashier/tournament-live/handinput/tableIdentity";

const physicalTableId = "11111111-1111-4111-8111-111111111111";
const canonicalTableId = "22222222-2222-4222-8222-222222222222";

describe("resolveTournamentTableId", () => {
  it("maps a physical table to its distinct canonical tournament-table id", () => {
    expect(resolveTournamentTableId([
      { id: canonicalTableId, table_id: physicalTableId },
    ], physicalTableId)).toBe(canonicalTableId);
  });

  it("fails closed for the wrong physical id", () => {
    expect(resolveTournamentTableId([
      { id: canonicalTableId, table_id: physicalTableId },
    ], "33333333-3333-4333-8333-333333333333")).toBeNull();
  });

  it("fails closed when the physical mapping is ambiguous", () => {
    expect(resolveTournamentTableId([
      { id: canonicalTableId, table_id: physicalTableId },
      { id: "44444444-4444-4444-8444-444444444444", table_id: physicalTableId },
    ], physicalTableId)).toBeNull();
  });

  it("fails closed when the canonical mapping is absent", () => {
    expect(resolveTournamentTableId([{ id: canonicalTableId, table_id: null }], physicalTableId)).toBeNull();
  });
});
