import { describe, expect, it } from "vitest";
import {
  TOURNAMENT_CREATE_LIVE_STATUS,
  withTournamentCreateLiveStatus,
} from "../tournamentCreateCompatibility";

describe("withTournamentCreateLiveStatus", () => {
  it("sets the status accepted by the deployed validation trigger", () => {
    expect(withTournamentCreateLiveStatus({ name: "UAT" })).toEqual({
      name: "UAT",
      live_status: TOURNAMENT_CREATE_LIVE_STATUS,
    });
  });

  it("cannot inherit or preserve the incompatible upcoming default", () => {
    expect(withTournamentCreateLiveStatus({ live_status: "upcoming" })).toEqual({
      live_status: "registering",
    });
  });
});
