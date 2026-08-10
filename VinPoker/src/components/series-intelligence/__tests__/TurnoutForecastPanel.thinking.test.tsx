import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TurnoutForecastPanel } from "../TurnoutForecastPanel";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";

vi.mock("@/lib/series-intelligence/useNativeSeriesEvents", () => ({ useNativeSeriesEvents: () => ({ events: [] }) }));
vi.mock("../VThinkingIndicator", () => ({
  VThinkingIndicator: () => <div data-testid="v-thinking-indicator" role="status">Đang dự báo khách ngày mai</div>,
}));

const tomorrow = "2026-02-15";

function event(day: number, entries: number): SeriesEvent {
  return {
    event_id: `event-${day}`,
    event_name: "Main Event",
    event_date: `2026-01-${String(day).padStart(2, "0")}T19:00:00+07:00`,
    buy_in: 2_000_000,
    fee: 100_000,
    serviceFeeAmount: null,
    gtd: 20_000_000,
    prize_pool_actual: null,
    total_entries: entries,
    unique_entries: entries,
    reentries: 0,
    source: "csv",
    clubId: "club-1",
    missingFields: [],
  };
}

const history = Array.from({ length: 12 }, (_, index) => event(index + 1, 120 + index * 3));

function fillTomorrowForecast() {
  fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: tomorrow } });
  const buyIn = Array.from(document.querySelectorAll('input[type="number"]')).find(
    (input) => (input as HTMLInputElement).placeholder.includes("3000000"),
  )!;
  fireEvent.change(buyIn, { target: { value: "2000000" } });
}

describe("TurnoutForecastPanel tomorrow thinking state", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-14T10:00:00+07:00"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the solving orb for ten seconds before revealing a tomorrow forecast", () => {
    render(<TurnoutForecastPanel csvEvents={history} />);
    fillTomorrowForecast();

    expect(screen.getByTestId("v-thinking-indicator")).toBeInTheDocument();
    expect(screen.queryByText("Dự đoán lượng khách")).toBeNull();

    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByTestId("v-thinking-indicator")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("v-thinking-indicator")).toBeNull();
    expect(screen.getByText("Dự đoán lượng khách")).toBeInTheDocument();
  });

  it("keeps non-tomorrow forecasts immediate", () => {
    render(<TurnoutForecastPanel csvEvents={history} />);
    fireEvent.change(document.querySelector('input[type="date"]')!, { target: { value: "2026-02-16" } });
    const buyIn = Array.from(document.querySelectorAll('input[type="number"]')).find(
      (input) => (input as HTMLInputElement).placeholder.includes("3000000"),
    )!;
    fireEvent.change(buyIn, { target: { value: "2000000" } });

    expect(screen.queryByTestId("v-thinking-indicator")).toBeNull();
    expect(screen.getByText("Dự đoán lượng khách")).toBeInTheDocument();
  });

  it("restarts the full thinking period when tomorrow's forecast inputs change", () => {
    render(<TurnoutForecastPanel csvEvents={history} />);
    fillTomorrowForecast();

    act(() => vi.advanceTimersByTime(5_000));
    fireEvent.change(document.querySelector('input[type="time"]')!, { target: { value: "20:00" } });

    act(() => vi.advanceTimersByTime(9_999));
    expect(screen.getByTestId("v-thinking-indicator")).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId("v-thinking-indicator")).toBeNull();
  });
});
