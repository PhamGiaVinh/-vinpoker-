// tests/playerIntelligence/format.test.ts — Smart Player Card pure logic + copy guard.
import { describe, it, expect } from "vitest";
// Import the PURE modules directly (not the barrel) — the barrel re-exports the
// supabase-backed hook, which can't init in the test env.
import {
  FORBIDDEN_TERMS,
  formatExpected,
  formatPercent,
  formatSourceQuality,
  getNextBestAction,
  getProfileMilestones,
  isRawObservedRate,
  isScenarioUnlocked,
} from "@/lib/player-intelligence/format";
import { parsePlayerIntelligence } from "@/lib/player-intelligence/types";
import vi from "@/i18n/locales/vi.json";

const base = {
  profileStatus: "new",
  confidence: "low",
  verifiedSample: { totalEntries: 0, uniqueEvents: 0, reentries: 0, lastPlayedAt: null },
  results: {},
  bands: {},
  sourceQuality: { finishPosition: "missing", itm: "unknown", finalTable: "derived_position", fieldSize: "unknown", structure: "unknown", identity: "online_authenticated" },
  scenarioOutlook: { unlocked: false, reasonLocked: "not_enough_verified_entries", basedOn: { verifiedEntries: 0, itmRate: null, rateMethod: "raw_observed", confidence: "low" }, windows: [] },
  locked: { scenarioOutlook: true, dreamLadder: true },
};

const lockedVerified = {
  ...base,
  profileStatus: "verified",
  verifiedSample: { totalEntries: 6, uniqueEvents: 5, reentries: 1, lastPlayedAt: "2026-09-20T00:00:00Z" },
  results: { itmRate: 0.33, finalTableRate: 0.16, top3Rate: 0, avgNormalizedFinish: 0.6, recentFormDelta: null },
  scenarioOutlook: { unlocked: false, reasonLocked: "not_enough_verified_entries", basedOn: { verifiedEntries: 6, itmRate: 0.33, rateMethod: "raw_observed", confidence: "low" }, windows: [] },
};

const unlocked = {
  ...lockedVerified,
  confidence: "medium",
  verifiedSample: { totalEntries: 12, uniqueEvents: 10, reentries: 2, lastPlayedAt: "2026-09-28T00:00:00Z" },
  results: { itmRate: 0.25, finalTableRate: 0.11, top3Rate: 0.05, avgNormalizedFinish: 0.58, recentFormDelta: -0.02 },
  scenarioOutlook: {
    unlocked: true,
    reasonLocked: null,
    basedOn: { verifiedEntries: 12, itmRate: 0.25, rateMethod: "raw_observed", confidence: "medium" },
    windows: [
      { tournaments: 4, expectedItm: 1, chanceAtLeastOneItm: 0.6836 },
      { tournaments: 8, expectedItm: 2, chanceAtLeastOneItm: 0.8999 },
      { tournaments: 12, expectedItm: 3, chanceAtLeastOneItm: 0.9683 },
    ],
  },
};

describe("parse + state helpers", () => {
  it("no-data → profileStatus 'new' + drill action, scenario locked", () => {
    const pi = parsePlayerIntelligence(base)!;
    expect(pi.profileStatus).toBe("new");
    expect(isScenarioUnlocked(pi)).toBe(false);
    expect(getNextBestAction(pi)[0]).toBe("play_drill");
  });

  it("<10 verified entries → scenario locked, keep-playing action", () => {
    const pi = parsePlayerIntelligence(lockedVerified)!;
    expect(isScenarioUnlocked(pi)).toBe(false);
    expect(getNextBestAction(pi)).toEqual(["keep_playing_recorded"]);
  });

  it("unlocked outlook → fit-events + track-progress actions", () => {
    const pi = parsePlayerIntelligence(unlocked)!;
    expect(isScenarioUnlocked(pi)).toBe(true);
    expect(getNextBestAction(pi)).toEqual(["see_fit_events", "track_progress"]);
  });

  it("raw_observed rate is surfaced honestly", () => {
    const pi = parsePlayerIntelligence(unlocked)!;
    expect(isRawObservedRate(pi)).toBe(true);
    expect(formatSourceQuality("raw_observed")).toBe("playerIntelligence.sqValue.raw_observed");
  });

  it("missing / garbage input never crashes", () => {
    expect(parsePlayerIntelligence(null)).toBeNull();
    expect(parsePlayerIntelligence(undefined)).toBeNull();
    const pi = parsePlayerIntelligence({})!;
    expect(pi.profileStatus).toBe("new");
    expect(formatSourceQuality(undefined)).toBe("playerIntelligence.sqValue.unknown");
    expect(formatSourceQuality("weird_value")).toBe("playerIntelligence.sqValue.unknown");
  });
});

describe("profile milestones (aspirational ladder)", () => {
  it("no data → next step is 'start', 1 event to go, nothing reached", () => {
    const ms = getProfileMilestones(parsePlayerIntelligence(base)!);
    expect(ms.current).toBe(0);
    expect(ms.steps.every((s) => !s.reached)).toBe(true);
    expect(ms.next?.key).toBe("start");
    expect(ms.remaining).toBe(1);
  });

  it("6 verified entries → start+verified reached, next is outlook, 4 to go", () => {
    const ms = getProfileMilestones(parsePlayerIntelligence(lockedVerified)!);
    expect(ms.current).toBe(6);
    expect(ms.steps.find((s) => s.key === "verified")?.reached).toBe(true);
    expect(ms.next?.key).toBe("outlook");
    expect(ms.remaining).toBe(4);
  });

  it("12 entries → all reached, no next milestone", () => {
    const ms = getProfileMilestones(parsePlayerIntelligence(unlocked)!);
    expect(ms.steps.every((s) => s.reached)).toBe(true);
    expect(ms.next).toBeNull();
    expect(ms.remaining).toBeNull();
  });
});

describe("number formatting", () => {
  it("percent and expected", () => {
    expect(formatPercent(0.6836)).toBe("68%");
    expect(formatPercent(0.25)).toBe("25%");
    expect(formatPercent(null)).toBeNull();
    expect(formatExpected(1.0)).toBe("~1");
    expect(formatExpected(2.4)).toBe("~2");
    expect(formatExpected(null)).toBeNull();
  });
});

describe("honesty guard", () => {
  it("vi playerIntelligence copy never contains forbidden terms", () => {
    const vals: string[] = [];
    const walk = (o: any) => {
      for (const k in o) {
        const v = o[k];
        if (typeof v === "string") vals.push(v);
        else if (v && typeof v === "object") walk(v);
      }
    };
    walk((vi as any).playerIntelligence);
    expect(vals.length).toBeGreaterThan(20);
    for (const v of vals) {
      for (const term of FORBIDDEN_TERMS) {
        expect(v.toLowerCase().includes(term.toLowerCase()), `"${v}" contains forbidden "${term}"`).toBe(false);
      }
    }
  });
});
