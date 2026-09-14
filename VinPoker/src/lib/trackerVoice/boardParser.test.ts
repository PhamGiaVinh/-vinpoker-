import { describe, expect, it } from "vitest";
import { parseVoiceBoardCommand } from "./boardParser";
import { routeTrackerVoiceIntent } from "./intentRouter";

describe("Voice Board grammar", () => {
  it.each([
    ["Flop Át cơ, năm bích, hai rô", "flop", ["Ah", "5s", "2d"]],
    ["turn queen clubs", "turn", ["Qc"]],
    ["river 10 diamonds", "river", ["Td"]],
    ["flop K big 9 cơ 5 rô", "flop", ["Ks", "9h", "5d"]],
    ["flop năm bích 7 cơ 2 tép", "flop", ["5s", "7h", "2c"]],
    ["turn 2 dô", "turn", ["2d"]],
    ["river át tép", "river", ["Ac"]],
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
    expect(routeTrackerVoiceIntent("flop K bích 9 cơ 5 rô", "runout_reveal")).toMatchObject({
      ok: true,
      intentDomain: "board",
    });
  });
});
