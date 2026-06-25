// Viewer Felt V2 (liveViewerFeltV2 → LiveFelt `viewerLayout`) — the PUBLIC spectator
// felt must size every card with the FELT's own width (CSS container query + clamp) so
// hole cards can't overlap each other / the board on mobile. These pin the anti-overlap
// contract: with viewerLayout ON the oval is a size container and cards carry `cqi`
// clamp sizing; with it OFF (operator/TV/replay) NO container query leaks in, and the
// card structure (5 board + 2 per seat) is preserved either way.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveFelt, type SeatInfo } from "@/components/cashier/tournament-live/LiveFelt";

const noBB = () => null;

function seat(over: Partial<SeatInfo>): SeatInfo {
  return {
    player_id: over.player_id ?? "p",
    display_name: over.display_name ?? "Player",
    seat_number: over.seat_number ?? 1,
    chip_count: over.chip_count ?? 1000,
    is_active: true,
    table_id: "t",
    position: "",
    ...over,
  };
}

const baseProps = {
  lastActorId: null,
  toActId: null,
  displayCards: ["", "", "", "", ""],
  potSize: 0,
  potBreakdown: null,
  multiTableUnresolved: false,
  handNumber: 1,
  latestAction: null,
  formatBB: noBB,
};

function seatCardCounts(html: string): number[] {
  const slots = html.split('data-testid="seat-holecards"').slice(1);
  return slots.map((seg) => {
    const backs = (seg.match(/data-testid="card-back"/g) || []).length;
    const faces = (seg.match(/tracker-card-reveal/g) || []).length;
    return backs + faces;
  });
}

const seats = [
  seat({ player_id: "a", seat_number: 1, hole_cards: ["Ah", "Kd"] }), // revealed → faces
  seat({ player_id: "b", seat_number: 2 }), // hidden → backs
  seat({ player_id: "c", seat_number: 3 }),
];

describe("LiveFelt viewerLayout (Viewer Felt V2)", () => {
  it("makes the felt a size container and sizes cards with cqi clamp (portrait)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait viewerLayout />);
    // The oval becomes a container so card `cqi` resolves to the felt width.
    expect(html).toContain("container-type:inline-size");
    // Hole + board cards carry the responsive clamp (cqi is unique to this sizing —
    // the felt's V mark uses vw, so a bare `clamp(` check would be ambiguous).
    expect(html).toContain("6.2cqi"); // portrait hole-card width clamp
    expect(html).toContain("8.4cqi"); // portrait board-card width clamp
  });

  it("uses the landscape clamp set when not portrait", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} viewerLayout />);
    expect(html).toContain("container-type:inline-size");
    expect(html).toContain("3.0cqi"); // landscape hole-card width clamp
    expect(html).toContain("4.6cqi"); // landscape board-card width clamp
  });

  it("never leaks the container query into the operator/TV render (viewerLayout off)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait />);
    expect(html).not.toContain("cqi");
    expect(html).not.toContain("container-type");
  });

  it("preserves the card structure: 5 board cards + exactly 2 per seat", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={seats} {...baseProps} portrait viewerLayout displayCards={["Ah", "Kd", "Qc", "", ""]} />
    );
    const board = (html.split('data-testid="board-cards"')[1] ?? "").split('data-testid="seat-holecards"')[0] ?? "";
    const boardCards = (board.match(/tracker-card-reveal/g) || []).length + (board.match(/data-testid="card-back"/g) || []).length;
    expect(boardCards).toBe(5);
    seatCardCounts(html).forEach((c) => expect(c).toBe(2));
  });

  it("forces its own neon premium surface (independent of viewerNeon)", () => {
    // viewerLayout ON but viewerNeon OFF → still neon (primary rim), not burgundy gold.
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait viewerLayout viewerNeon={false} />);
    expect(html).toContain("--primary"); // neon rim/glow uses --primary
  });
});

// RPT committed-chip pill: viewerLayout shows ONE colored pill (red all-in / emerald
// regular) and merges the standalone ALL IN label; the operator (viewerLayout off) shows
// NO pill even with current_bet populated (byte-identical) but keeps the ALL IN label.
describe("LiveFelt RPT committed-chip pill (viewerLayout)", () => {
  it("all-in → a red pill, and the standalone text-red-400 ALL IN label is gone", () => {
    const s = [seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 12100000 })];
    const html = renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} portrait viewerLayout />);
    expect(html).toContain("rgb(184,31,31)"); // the red all-in pill
    expect(html).toContain("ALL IN");
    expect(html).not.toContain("text-red-400"); // merged in → no standalone label
  });

  it("regular committed bet → an emerald pill (not red)", () => {
    const s = [seat({ player_id: "a", seat_number: 1, current_bet: 200000 })];
    const html = renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} viewerLayout />);
    expect(html).toContain("146 62% 56%"); // emerald text/border
    expect(html).not.toContain("rgb(184,31,31)");
  });

  it("operator path (viewerLayout off) renders NO bet pill even with current_bet, keeps ALL IN label", () => {
    const s = [seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 999000 })];
    const html = renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} />);
    expect(html).not.toContain("rgb(184,31,31)"); // no red pill
    expect(html).not.toContain("146 62% 56%"); // no emerald pill
    expect(html).toContain("text-red-400"); // the standalone ALL IN label stays (as today)
  });
});
