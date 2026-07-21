import { describe, expect, it } from "vitest";

import {
  canUseTournamentClockPostStartControls,
  getTournamentClockPrimaryAction,
} from "./clockControlState";

describe("getTournamentClockPrimaryAction", () => {
  it("offers start only for a non-terminal clock that has not started", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "registration",
        is_running: false,
        current_level: null,
        message: "Clock not started",
      }),
    ).toBe("start");
  });

  it("offers pause for a running live clock", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "live",
        is_running: true,
        current_level: { level_number: 1 },
      }),
    ).toBe("pause");
  });

  it("offers start for a legacy live row only when the server says it never started", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "live",
        is_running: false,
        current_level: null,
        message: "Clock not started",
      }),
    ).toBe("start");
  });

  it("offers resume for a paused live clock without a raw pause timestamp", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "live",
        is_running: false,
        current_level: { level_number: 1 },
      }),
    ).toBe("resume");
  });

  it("offers resume for a paused final-table clock", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "final_table",
        is_running: false,
        current_level: { level_number: 9 },
      }),
    ).toBe("resume");
  });

  it("fails closed when a live clock has no current level", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "live",
        is_running: false,
        current_level: null,
        message: "Current level not found",
      }),
    ).toBeNull();
  });

  it.each(["completed", "cancelled", "finished"])(
    "does not offer start for terminal status %s",
    (status) => {
      expect(
        getTournamentClockPrimaryAction({
          status,
          is_running: false,
          current_level: null,
          message: "Clock not started",
        }),
      ).toBeNull();
    },
  );

  it("does not guess whether an ambiguous break clock should resume", () => {
    expect(
      getTournamentClockPrimaryAction({
        status: "break",
        is_running: false,
        current_level: { level_number: 2, is_break: true },
      }),
    ).toBeNull();
  });

  it("fails closed for a partial payload", () => {
    expect(getTournamentClockPrimaryAction({ status: "live" })).toBeNull();
    expect(
      getTournamentClockPrimaryAction({
        is_running: false,
        current_level: null,
        message: "Clock not started",
      }),
    ).toBeNull();
  });
});

describe("canUseTournamentClockPostStartControls", () => {
  it.each([
    ["live", true],
    ["live", false],
    ["final_table", true],
    ["final_table", false],
  ])("allows resolved active status %s with running=%s", (status, isRunning) => {
    expect(
      canUseTournamentClockPostStartControls({
        status,
        is_running: isRunning,
        current_level: { level_number: 1 },
      }),
    ).toBe(true);
  });

  it.each(["registration", "completed", "cancelled", "finished", "break"])(
    "fails closed for status %s",
    (status) => {
      expect(
        canUseTournamentClockPostStartControls({
          status,
          is_running: false,
          current_level: { level_number: 1 },
        }),
      ).toBe(false);
    },
  );

  it("fails closed without a level or resolved running state", () => {
    expect(
      canUseTournamentClockPostStartControls({
        status: "live",
        is_running: false,
        current_level: null,
      }),
    ).toBe(false);
    expect(
      canUseTournamentClockPostStartControls({
        status: "live",
        current_level: { level_number: 1 },
      }),
    ).toBe(false);
  });
});
