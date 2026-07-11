import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TableMotionLayer, TableMotionVisual } from "@/components/cashier/tournament-live/TableMotionLayer";
import { FEATURES } from "@/lib/featureFlags";
import type { TableMotionEvent } from "@/lib/tracker-poker/tableMotion";

const positions = { 1: { l: 20, t: 75 }, 2: { l: 80, t: 25 } };
const base = { seatPositions: positions, potPosition: { l: 50, t: 46 }, aspectRatio: 3 / 4, speed: 1 };
const originalMatchMedia = window.matchMedia;
const matchMediaResult = (matches: boolean) => ({
  matches,
  media: "(prefers-reduced-motion: reduce)",
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
});

describe("TableMotionVisual", () => {
  it.each<TableMotionEvent>([
    { id: "deal", handId: "h", kind: "deal_hole", seatNumbers: [1, 2] },
    { id: "fold", handId: "h", kind: "fold_muck", seatNumber: 1 },
    { id: "board", handId: "h", kind: "board_reveal", street: "flop", cards: ["As", "Kd", "Qc"] },
    { id: "show", handId: "h", kind: "showdown_reveal", seatNumbers: [1, 2] },
    { id: "award", handId: "h", kind: "pot_award", awards: [{ potIndex: 0, amount: 1000, winnerSeatNumbers: [1, 2] }] },
  ])("renders the $kind overlay without exposing card values or award amounts", (event) => {
    const html = renderToStaticMarkup(<TableMotionVisual event={event} {...base} />);
    expect(html).not.toContain("As");
    expect(html).not.toContain("1000");
    expect(html).toMatch(/tracker-motion-(card|showdown|chip)/);
  });

  it("keeps the production gate off and renders no overlay while disabled", () => {
    const html = renderToStaticMarkup(
      <TableMotionLayer
        enabled={false}
        handKey="h"
        events={[{ id: "deal", handId: "h", kind: "deal_hole", seatNumbers: [1, 2] }]}
        {...base}
      />,
    );

    expect(FEATURES.liveTableMotionV2).toBe(false);
    expect(html).toBe("");
  });

  it("plays queued events in order and cancels them when the hand changes", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue(matchMediaResult(false)),
    });
    const events: TableMotionEvent[] = [
      { id: "fold", handId: "h1", kind: "fold_muck", seatNumber: 1 },
      { id: "board", handId: "h1", kind: "board_reveal", street: "flop", cards: ["As", "Kd", "Qc"] },
    ];
    const view = render(<TableMotionLayer enabled handKey="h1" events={events} {...base} />);

    expect(view.getByTestId("table-motion-layer").getAttribute("data-motion-kind")).toBe("fold_muck");
    act(() => vi.advanceTimersByTime(281));
    expect(view.getByTestId("table-motion-layer").getAttribute("data-motion-kind")).toBe("board_reveal");

    view.rerender(<TableMotionLayer enabled handKey="h2" events={events} {...base} />);
    expect(view.queryByTestId("table-motion-layer")).toBeNull();
  });

  it("does not retain a motion queue when reduced motion is requested", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue(matchMediaResult(true)),
    });
    const view = render(
      <TableMotionLayer
        enabled
        handKey="h"
        events={[{ id: "deal", handId: "h", kind: "deal_hole", seatNumbers: [1, 2] }]}
        {...base}
      />,
    );

    expect(view.queryByTestId("table-motion-layer")).toBeNull();
  });
});
