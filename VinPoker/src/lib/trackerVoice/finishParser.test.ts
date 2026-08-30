import { describe, expect, it } from "vitest";
import { parseVoiceFinishCommand } from "./finishParser";
import { routeTrackerVoiceIntent } from "./intentRouter";

describe("Voice Finish grammar", () => {
  it("accepts only the normalized whole phrase", () => {
    expect(parseVoiceFinishCommand("  KẾT THÚC HAND! ")).toMatchObject({
      kind: "finish_hand",
      normalizedTranscript: "ket thuc hand",
    });
    expect(parseVoiceFinishCommand("kết thúc hand ngay")).toBeNull();
    expect(parseVoiceFinishCommand("xin kết thúc hand")).toBeNull();
    expect(parseVoiceFinishCommand("kết thúc ván")).toBeNull();
  });

  it("runs Finish beside every other grammar and only permits submit_ready", () => {
    expect(routeTrackerVoiceIntent("kết thúc hand", "submit_ready")).toMatchObject({
      ok: true,
      intentDomain: "finish_hand",
    });
    expect(routeTrackerVoiceIntent("kết thúc hand", "river_action")).toMatchObject({
      ok: false,
      code: "wrong_workflow",
    });
    expect(routeTrackerVoiceIntent("kết thúc hand ngay", "submit_ready")).toMatchObject({
      ok: false,
      code: "command_not_supported",
    });
  });
});
