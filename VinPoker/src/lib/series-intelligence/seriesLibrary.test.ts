import { describe, it, expect, beforeEach } from "vitest";
import type { SeriesEvent } from "./nativeData";
import {
  addSeries,
  removeSeries,
  renameSeries,
  setActive,
  clearLibrary,
  emptyLibrary,
  deriveSeriesDate,
  makeSeriesFromParse,
  validateEnvelope,
  serializeLibrary,
  checkLibrarySize,
  loadLibrary,
  saveLibrary,
  clearStoredLibrary,
  isSafeKey,
  SERIES_LIBRARY_STORAGE_KEY,
  SERIES_LIBRARY_VERSION,
  MAX_LIBRARY_BYTES,
  type Series,
  type SeriesLibrary,
} from "./seriesLibrary";

/** Minimal valid SeriesEvent for tests. */
function evt(over: Partial<SeriesEvent> = {}): SeriesEvent {
  return {
    event_id: "csv-1",
    event_name: "E",
    event_date: "2026-06-15",
    buy_in: 1_000_000,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: null,
    prize_pool_actual: null,
    total_entries: 100,
    unique_entries: 80,
    reentries: 20,
    source: "csv",
    clubId: "csv-test",
    missingFields: [],
    ...over,
  };
}

function ser(id: string, loadedAt: number, events: SeriesEvent[] = [evt()]): Series {
  return { id, name: id, seriesDate: "2026-06-15", sourceFilename: `${id}.csv`, events, loadedAt };
}

describe("reducers", () => {
  it("addSeries appends and makes the new series active", () => {
    let lib = emptyLibrary();
    lib = addSeries(lib, ser("a", 1));
    lib = addSeries(lib, ser("b", 2));
    expect(lib.series.map((s) => s.id)).toEqual(["a", "b"]);
    expect(lib.activeId).toBe("b"); // default-active = most-recently-loaded
  });

  it("removeSeries of the active re-points to the newest survivor", () => {
    let lib: SeriesLibrary = { series: [ser("a", 1), ser("b", 2), ser("c", 3)], activeId: "c" };
    lib = removeSeries(lib, "c");
    expect(lib.series.map((s) => s.id)).toEqual(["a", "b"]);
    expect(lib.activeId).toBe("b"); // newest remaining
  });

  it("removeSeries of a non-active series leaves active untouched", () => {
    const lib: SeriesLibrary = { series: [ser("a", 1), ser("b", 2)], activeId: "b" };
    expect(removeSeries(lib, "a").activeId).toBe("b");
  });

  it("removeSeries of the last series → activeId null (reverts to live native)", () => {
    const lib: SeriesLibrary = { series: [ser("a", 1)], activeId: "a" };
    const next = removeSeries(lib, "a");
    expect(next.series).toEqual([]);
    expect(next.activeId).toBeNull();
  });

  it("renameSeries trims; empty keeps old; unknown id is a no-op", () => {
    const lib: SeriesLibrary = { series: [ser("a", 1)], activeId: "a" };
    expect(renameSeries(lib, "a", "  New  ").series[0].name).toBe("New");
    expect(renameSeries(lib, "a", "   ").series[0].name).toBe("a"); // empty rejected
    expect(renameSeries(lib, "zzz", "X").series[0].name).toBe("a"); // unknown id
  });

  it("setActive only honors an existing id", () => {
    const lib: SeriesLibrary = { series: [ser("a", 1)], activeId: "a" };
    expect(setActive(lib, "nope").activeId).toBe("a");
    const lib2: SeriesLibrary = { series: [ser("a", 1), ser("b", 2)], activeId: "b" };
    expect(setActive(lib2, "a").activeId).toBe("a");
  });

  it("clearLibrary → empty", () => {
    expect(clearLibrary()).toEqual({ series: [], activeId: null });
  });

  it("deriveSeriesDate = earliest non-null date, else null", () => {
    expect(deriveSeriesDate([evt({ event_date: "2026-07-01" }), evt({ event_date: "2026-06-10" })])).toBe("2026-06-10");
    expect(deriveSeriesDate([evt({ event_date: null }), evt({ event_date: null })])).toBeNull();
  });

  it("makeSeriesFromParse strips .csv, fills a non-empty id + finite loadedAt", () => {
    const s = makeSeriesFromParse("Sunday Major.csv", [evt()]);
    expect(s.name).toBe("Sunday Major");
    expect(s.sourceFilename).toBe("Sunday Major.csv");
    expect(s.id.length).toBeGreaterThan(0);
    expect(Number.isFinite(s.loadedAt)).toBe(true);
    expect(makeSeriesFromParse("", [evt()]).name).toBe("Series"); // fallback
  });
});

describe("validateEnvelope — rehydrate safety", () => {
  const valid = (): unknown => JSON.parse(serializeLibrary({ series: [ser("a", 1)], activeId: "a" }));

  it("round-trips a valid envelope", () => {
    const lib = validateEnvelope(valid());
    expect(lib.series.map((s) => s.id)).toEqual(["a"]);
    expect(lib.activeId).toBe("a");
  });

  it("wrong version / non-object / array / primitive → empty (never throws)", () => {
    expect(validateEnvelope({ version: 999, library: { series: [], activeId: null } })).toEqual(emptyLibrary());
    expect(validateEnvelope(null)).toEqual(emptyLibrary());
    expect(validateEnvelope([1, 2, 3])).toEqual(emptyLibrary());
    expect(validateEnvelope("nope")).toEqual(emptyLibrary());
    expect(validateEnvelope(42)).toEqual(emptyLibrary());
  });

  it("does NOT pollute Object.prototype from a __proto__/constructor/prototype payload", () => {
    const poison = JSON.parse(
      `{"version":${SERIES_LIBRARY_VERSION},"library":{"series":[{"__proto__":{"polluted":true},"constructor":{"x":1},"id":"a","sourceFilename":"a.csv","events":[{"event_id":"csv-1"}]}],"activeId":"a"}}`,
    );
    const lib = validateEnvelope(poison);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(({} as any).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(lib.series[0], "polluted")).toBe(false);
    expect(lib.series[0].id).toBe("a"); // the real fields survive
  });

  it("sanitizes events: bad numerics→null, non-string event_id dropped, source forced csv, bad missingFields→[]", () => {
    const env = {
      version: SERIES_LIBRARY_VERSION,
      library: {
        series: [
          {
            id: "a",
            sourceFilename: "a.csv",
            events: [
              { event_id: "csv-1", buy_in: "1000" as unknown, total_entries: NaN, source: "native", missingFields: "x" },
              { event_id: 123 }, // non-string id → dropped
              { event_id: "", buy_in: 5 }, // blank id → dropped
            ],
          },
        ],
        activeId: "a",
      },
    };
    const lib = validateEnvelope(env);
    expect(lib.series[0].events).toHaveLength(1); // two dropped
    const e = lib.series[0].events[0];
    expect(e.buy_in).toBeNull(); // string → null
    expect(e.total_entries).toBeNull(); // NaN → null
    expect(e.source).toBe("csv"); // claimed "native" overridden
    expect(e.missingFields).toEqual([]); // non-array → []
  });

  it("drops a series with no valid events; dangling activeId → newest survivor", () => {
    const env = {
      version: SERIES_LIBRARY_VERSION,
      library: {
        series: [
          { id: "empty", sourceFilename: "e.csv", events: [] },
          { id: "a", sourceFilename: "a.csv", events: [{ event_id: "csv-1" }], loadedAt: 1 },
          { id: "b", sourceFilename: "b.csv", events: [{ event_id: "csv-1" }], loadedAt: 2 },
        ],
        activeId: "ghost",
      },
    };
    const lib = validateEnvelope(env);
    expect(lib.series.map((s) => s.id)).toEqual(["a", "b"]);
    expect(lib.activeId).toBe("b"); // newest survivor
  });
});

describe("size guard", () => {
  it("flags a serialized library over the cap", () => {
    expect(checkLibrarySize("x".repeat(MAX_LIBRARY_BYTES + 1)).ok).toBe(false);
    expect(checkLibrarySize("ok").ok).toBe(true);
  });
});

describe("isSafeKey", () => {
  it("rejects dangerous keys", () => {
    expect(isSafeKey("__proto__")).toBe(false);
    expect(isSafeKey("constructor")).toBe(false);
    expect(isSafeKey("prototype")).toBe(false);
    expect(isSafeKey("name")).toBe(true);
  });
});

describe("localStorage round-trip (jsdom)", () => {
  beforeEach(() => clearStoredLibrary());

  it("save then load returns the same library", () => {
    const lib: SeriesLibrary = { series: [ser("a", 1), ser("b", 2)], activeId: "b" };
    const guard = saveLibrary(lib);
    expect(guard.ok).toBe(true);
    const loaded = loadLibrary();
    expect(loaded.series.map((s) => s.id)).toEqual(["a", "b"]);
    expect(loaded.activeId).toBe("b");
  });

  it("loadLibrary returns empty when nothing stored / garbage stored", () => {
    expect(loadLibrary()).toEqual(emptyLibrary());
    localStorage.setItem(SERIES_LIBRARY_STORAGE_KEY, "{not json");
    expect(loadLibrary()).toEqual(emptyLibrary());
  });

  it("saveLibrary over the cap returns {ok:false} and does NOT write", () => {
    clearStoredLibrary();
    const huge: SeriesLibrary = {
      series: [ser("a", 1, [evt({ event_name: "x".repeat(MAX_LIBRARY_BYTES) })])],
      activeId: "a",
    };
    const guard = saveLibrary(huge);
    expect(guard.ok).toBe(false);
    expect(guard.message).toBeTruthy();
    expect(localStorage.getItem(SERIES_LIBRARY_STORAGE_KEY)).toBeNull(); // nothing written
  });
});
