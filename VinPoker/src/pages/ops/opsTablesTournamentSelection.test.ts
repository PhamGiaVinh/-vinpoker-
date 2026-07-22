import { describe, expect, it } from "vitest";
import { resolveOpsTablesTournamentId } from "./opsTablesTournamentSelection";

const DEEP_LINK_ID = "11111111-1111-4111-8111-111111111111";
const FALLBACK_ID = "22222222-2222-4222-8222-222222222222";

describe("resolveOpsTablesTournamentId", () => {
  it.each([
    {
      name: "operator club scope is still loading",
      selectedClubId: null,
      operatorClubsLoading: true,
      tournamentsLoading: false,
    },
    {
      name: "club is selected and tournaments are still loading",
      selectedClubId: "33333333-3333-4333-8333-333333333333",
      operatorClubsLoading: false,
      tournamentsLoading: true,
    },
    {
      name: "operator scope resolved before a club is selected",
      selectedClubId: null,
      operatorClubsLoading: false,
      tournamentsLoading: false,
    },
  ])("preserves the requested tournament while $name", (loadingState) => {
    expect(resolveOpsTablesTournamentId({
      currentTournamentId: DEEP_LINK_ID,
      tournamentOptions: [],
      ...loadingState,
    })).toBe(DEEP_LINK_ID);
  });

  it("clears an unavailable tournament after loading finishes", () => {
    expect(resolveOpsTablesTournamentId({
      currentTournamentId: DEEP_LINK_ID,
      tournamentOptions: [],
      selectedClubId: "33333333-3333-4333-8333-333333333333",
      operatorClubsLoading: false,
      tournamentsLoading: false,
    })).toBeNull();
  });

  it("keeps a valid selected tournament", () => {
    expect(resolveOpsTablesTournamentId({
      currentTournamentId: DEEP_LINK_ID,
      tournamentOptions: [{ id: FALLBACK_ID }, { id: DEEP_LINK_ID }],
      selectedClubId: "33333333-3333-4333-8333-333333333333",
      operatorClubsLoading: false,
      tournamentsLoading: false,
    })).toBe(DEEP_LINK_ID);
  });

  it("falls back only after the loaded options prove the selection is unavailable", () => {
    expect(resolveOpsTablesTournamentId({
      currentTournamentId: DEEP_LINK_ID,
      tournamentOptions: [{ id: FALLBACK_ID }],
      selectedClubId: "33333333-3333-4333-8333-333333333333",
      operatorClubsLoading: false,
      tournamentsLoading: false,
    })).toBe(FALLBACK_ID);
  });
});
