import { describe, expect, it } from "vitest";
import {
  mapDisplayStateToTvData,
  parseDisplayStatePayload,
  type TvDisplayStatePayload,
} from "./mapDisplayState";

// Fixture mirrors the live get_tv_display_state envelope
// (contract: docs/agent-handoffs/tv-display-pairing.md).
const PAIRED: TvDisplayStatePayload = {
  status: "paired",
  display: {
    id: "d-1",
    name: "TV 1 — Sảnh chính",
    zone: "Main hall",
    display_number: 1,
    layout: "clock",
    theme: "dark",
    announcement: null,
    club_name: "VinPoker Club",
  },
  tournament: {
    id: "t-1",
    name: "VinPoker Weekly Deepstack",
    status: "live",
    players_remaining: 42,
    average_stack: 48500,
    prize_pool: 87_300_000,
  },
  clock: {
    tournament_id: "t-1",
    status: "live",
    is_running: true,
    elapsed_seconds: 180,
    remaining_seconds: 1020,
    current_level: {
      level_number: 8,
      small_blind: 1000,
      big_blind: 2000,
      ante: 2000,
      duration_minutes: 20,
      is_break: false,
    },
    is_break: false,
    next_level: null,
  },
  levels: [
    { level_number: 8, small_blind: 1000, big_blind: 2000, ante: 2000, duration_minutes: 20, is_break: false },
    { level_number: 9, small_blind: 0, big_blind: 0, ante: 0, duration_minutes: 10, is_break: true },
  ],
  entries: { total_confirmed: 97, total_buy_ins: 97_000_000 },
  re_entries: 12,
  prizes: [{ position: 1, amount: 35_000_000 }],
};

describe("parseDisplayStatePayload", () => {
  it("treats malformed payloads as invalid", () => {
    expect(parseDisplayStatePayload(null).status).toBe("invalid");
    expect(parseDisplayStatePayload("nope").status).toBe("invalid");
    expect(parseDisplayStatePayload({}).status).toBe("invalid");
  });

  it("passes well-formed payloads through", () => {
    expect(parseDisplayStatePayload({ status: "unpaired" }).status).toBe("unpaired");
    expect(parseDisplayStatePayload(PAIRED).status).toBe("paired");
  });
});

describe("mapDisplayStateToTvData", () => {
  it("maps a paired+assigned payload into the frozen TvData contract", () => {
    const data = mapDisplayStateToTvData(PAIRED, 1015);
    expect(data).not.toBeNull();
    expect(data!.tournamentName).toBe("VinPoker Weekly Deepstack");
    expect(data!.clubName).toBe("VinPoker Club");
    expect(data!.status).toBe("live");
    expect(data!.isRunning).toBe(true);
    expect(data!.remainingSeconds).toBe(1015); // drift-corrected, not the snapshot
    expect(data!.currentLevel?.levelNumber).toBe(8);
    expect(data!.nextBreakSeconds).toBe(1015); // level-9 break is next
    expect(data!.totalEntries).toBe(97);
    expect(data!.totalBuyIns).toBe(97_000_000);
    expect(data!.reEntries).toBe(12);
    expect(data!.prizes).toEqual([{ position: 1, amount: 35_000_000 }]);
  });

  it("clamps total entries to players remaining (walk-ins)", () => {
    const data = mapDisplayStateToTvData(
      { ...PAIRED, entries: { total_confirmed: 10, total_buy_ins: 10_000_000 } },
      1015,
    );
    expect(data!.totalEntries).toBe(42);
  });

  it("returns null for standby (no tournament assigned)", () => {
    expect(mapDisplayStateToTvData({ ...PAIRED, tournament: null, clock: null }, 0)).toBeNull();
  });

  it("returns null for non-paired states", () => {
    expect(mapDisplayStateToTvData({ status: "unpaired" }, 0)).toBeNull();
    expect(mapDisplayStateToTvData({ status: "revoked" }, 0)).toBeNull();
    expect(mapDisplayStateToTvData({ status: "invalid" }, 0)).toBeNull();
  });

  it("survives missing optional collections", () => {
    const data = mapDisplayStateToTvData(
      { ...PAIRED, levels: null, prizes: null, entries: null, re_entries: null },
      1015,
    );
    expect(data!.nextBreakSeconds).toBeNull();
    expect(data!.prizes).toEqual([]);
    expect(data!.totalBuyIns).toBeNull();
    expect(data!.reEntries).toBeNull();
    expect(data!.totalEntries).toBe(42); // falls back to players_remaining
  });
});
