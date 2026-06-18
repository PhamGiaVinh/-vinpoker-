import { describe, it, expect } from "vitest";
import {
  deriveEnginePhase,
  isActionPhase,
  isBoardEntryPhase,
  boardEntryStreet,
  type EnginePhaseInput,
} from "@/components/cashier/tournament-live/handinput/enginePhase";

const base: EnginePhaseInput = {
  handStarted: true,
  blindsConfirmed: true,
  currentStreet: "preflop",
  boardSent: false,
  isSummary: false,
};

describe("deriveEnginePhase — Street Gate sequence", () => {
  it("not started → button_setup; review → showdown", () => {
    expect(deriveEnginePhase({ ...base, handStarted: false })).toBe("button_setup");
    expect(deriveEnginePhase({ ...base, isSummary: true })).toBe("showdown");
  });

  it("preflop: blind_setup until blinds confirmed, then action_preflop", () => {
    expect(deriveEnginePhase({ ...base, blindsConfirmed: false })).toBe("blind_setup");
    expect(deriveEnginePhase({ ...base, blindsConfirmed: true })).toBe("action_preflop");
  });

  it("preflop complete advances to flop board: enter_flop until the board is sent", () => {
    // currentStreet=flop, board NOT persisted → enter_flop (NO flop ActionDock)
    const enter = deriveEnginePhase({ ...base, currentStreet: "flop", boardSent: false });
    expect(enter).toBe("enter_flop");
    expect(isActionPhase(enter)).toBe(false);
    // board persisted → action_flop
    expect(deriveEnginePhase({ ...base, currentStreet: "flop", boardSent: true })).toBe("action_flop");
  });

  it("turn + river gates require their board before action", () => {
    expect(deriveEnginePhase({ ...base, currentStreet: "turn", boardSent: false })).toBe("enter_turn");
    expect(deriveEnginePhase({ ...base, currentStreet: "turn", boardSent: true })).toBe("action_turn");
    expect(deriveEnginePhase({ ...base, currentStreet: "river", boardSent: false })).toBe("enter_river");
    expect(deriveEnginePhase({ ...base, currentStreet: "river", boardSent: true })).toBe("action_river");
  });

  it("showdown street → showdown", () => {
    expect(deriveEnginePhase({ ...base, currentStreet: "showdown", boardSent: true })).toBe("showdown");
  });
});

describe("phase helpers", () => {
  it("isBoardEntryPhase + boardEntryStreet", () => {
    expect(isBoardEntryPhase("enter_flop")).toBe(true);
    expect(isBoardEntryPhase("action_flop")).toBe(false);
    expect(boardEntryStreet("enter_flop")).toBe("flop");
    expect(boardEntryStreet("enter_turn")).toBe("turn");
    expect(boardEntryStreet("enter_river")).toBe("river");
    expect(boardEntryStreet("action_flop")).toBeNull();
  });
});
