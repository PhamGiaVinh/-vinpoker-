import { describe, expect, it } from "vitest";
import { parseVoiceBoardCommand } from "./boardParser";
import { routeTrackerVoiceIntent } from "./intentRouter";

describe("Voice Board grammar", () => {
  it.each([
    ["Flop Át cơ, năm bích, hai rô", "flop", ["Ah", "5s", "2d"]],
    ["turn queen clubs", "turn", ["Qc"]],
    ["river 10 diamonds", "river", ["Td"]],
  ])("parses the exact complete Board phrase %s", (raw, street, cards) => {
    expect(parseVoiceBoardCommand(raw)).toMatchObject({ street, newCards: cards });
  });

  it.each([
    "flop ace hearts five spades",
    "flop ace hearts five spades two diamonds now",
    "flop ace hearts ace hearts two diamonds",
    "turn fit hearts",
    "river ace unknown",
    "please flop ace hearts five spades two diamonds",
  ])("rejects incomplete, duplicate, fuzzy, and substring Board input: %s", (raw) => {
    expect(parseVoiceBoardCommand(raw)).toBeNull();
  });

  it("routes domains independently and rejects Board in an action workflow", () => {
    expect(routeTrackerVoiceIntent("flop ace hearts five spades two diamonds", "enter_flop")).toMatchObject({
      ok: true,
      intentDomain: "board",
    });
    expect(routeTrackerVoiceIntent("flop ace hearts five spades two diamonds", "preflop_action")).toEqual({
      ok: false,
      code: "wrong_workflow",
    });
    expect(routeTrackerVoiceIntent("fold", "enter_flop")).toEqual({ ok: false, code: "wrong_workflow" });
  });
});
