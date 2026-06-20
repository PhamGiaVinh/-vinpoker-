// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SeriesEvent } from "./nativeData";
import { useSeriesLibrary } from "./useSeriesLibrary";
import { clearStoredLibrary, loadLibrary, MAX_LIBRARY_BYTES } from "./seriesLibrary";

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

beforeEach(() => clearStoredLibrary());

describe("useSeriesLibrary", () => {
  it("adding a series persists it to localStorage (save-on-change)", () => {
    const { result } = renderHook(() => useSeriesLibrary());
    expect(result.current.count).toBe(0);
    act(() => result.current.addSeriesFromParse("a.csv", [evt(), evt({ event_id: "csv-2" })]));
    expect(result.current.count).toBe(1);
    expect(result.current.lastSaveError).toBeNull();
    // it was actually written to storage
    const stored = loadLibrary();
    expect(stored.series).toHaveLength(1);
    expect(stored.series[0].events).toHaveLength(2);
  });

  it("with exactly ONE series, activeEvents EQUALS the parser's events array (byte-identical claim)", () => {
    const events = [evt({ event_id: "csv-1" }), evt({ event_id: "csv-2" }), evt({ event_id: "csv-3" })];
    const { result } = renderHook(() => useSeriesLibrary());
    act(() => result.current.addSeriesFromParse("only.csv", events));
    expect(result.current.count).toBe(1);
    expect(result.current.activeEvents).toEqual(events); // same content the dashboard would have received before
    expect(result.current.activeEvents).toHaveLength(3);
  });

  it("loading multiple series; active follows the newest; select + remove + clearAll work", () => {
    const { result } = renderHook(() => useSeriesLibrary());
    act(() => result.current.addSeriesFromParse("a.csv", [evt()]));
    act(() => result.current.addSeriesFromParse("b.csv", [evt(), evt({ event_id: "csv-2" })]));
    expect(result.current.count).toBe(2);
    const aId = result.current.series[0].id;
    const bId = result.current.series[1].id;
    expect(result.current.activeId).toBe(bId); // newest active

    act(() => result.current.select(aId));
    expect(result.current.activeId).toBe(aId);

    act(() => result.current.remove(bId));
    expect(result.current.count).toBe(1);

    act(() => result.current.clearAll());
    expect(result.current.count).toBe(0);
    expect(result.current.activeEvents).toBeNull();
  });

  it("over-cap save surfaces lastSaveError (and the dashboard data still works in memory)", () => {
    const { result } = renderHook(() => useSeriesLibrary());
    act(() => result.current.addSeriesFromParse("huge.csv", [evt({ event_name: "x".repeat(MAX_LIBRARY_BYTES) })]));
    expect(result.current.lastSaveError).toBeTruthy();
    expect(result.current.count).toBe(1); // in-memory state still present
    expect(loadLibrary().series).toHaveLength(0); // the over-cap series was NOT persisted
  });
});
