import { describe, expect, it } from "vitest";
import { selectTvScreen } from "./selectTvScreen";

describe("selectTvScreen", () => {
  it("clock layout follows tournament data", () => {
    expect(selectTvScreen("clock", true)).toBe("clock");
    expect(selectTvScreen("clock", false)).toBe("standby");
  });

  it("unknown/missing layout behaves like clock", () => {
    expect(selectTvScreen(undefined, true)).toBe("clock");
    expect(selectTvScreen(null, false)).toBe("standby");
    expect(selectTvScreen("something_new", true)).toBe("clock");
  });

  it("announcement renders regardless of tournament data", () => {
    expect(selectTvScreen("announcement", true)).toBe("announcement");
    expect(selectTvScreen("announcement", false)).toBe("announcement");
  });

  it("break_screen and payouts need tournament data", () => {
    expect(selectTvScreen("break_screen", true)).toBe("break");
    expect(selectTvScreen("break_screen", false)).toBe("standby");
    expect(selectTvScreen("payouts", true)).toBe("payouts");
    expect(selectTvScreen("payouts", false)).toBe("standby");
  });

  it("multi_board is an honest placeholder until the data RPC exists", () => {
    expect(selectTvScreen("multi_board", true)).toBe("multi_placeholder");
    expect(selectTvScreen("multi_board", false)).toBe("multi_placeholder");
  });
});
