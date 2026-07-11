// Viewer Felt V2 (liveViewerFeltV2 → LiveFelt `viewerLayout`) — the PUBLIC spectator
// felt must size every card with the FELT's own width (CSS container query + clamp) so
// hole cards can't overlap each other / the board on mobile. These pin the anti-overlap
// contract: with viewerLayout ON the oval is a size container and cards carry `cqi`
// clamp sizing; with it OFF (operator/TV/replay) NO container query leaks in, and the
// card structure is preserved: 2 per seat always; the board keeps all 5 slots on
// operator/TV, but the VIEWER shows only DEALT community cards (undealt slots render
// nothing, so the face-down backs no longer cover the top-center pods) + hides the V.

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
  const board5 = ["Ah", "Kd", "Qc", "Jc", "2s"];

  it("makes the felt a size container and sizes cards with cqi clamp (portrait)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} displayCards={board5} portrait viewerLayout />);
    // The oval becomes a container so card `cqi` resolves to the felt width.
    expect(html).toContain("container-type:inline-size");
    // Hole + board cards carry the responsive clamp (cqi is unique to this sizing —
    // the felt's V mark uses vw, so a bare `clamp(` check would be ambiguous).
    expect(html).toContain("8.8cqi"); // portrait hole-card width clamp, enlarged for SVG clarity
    expect(html).toContain("8.4cqi"); // portrait board-card width clamp
  });

  it("uses the landscape clamp set when not portrait", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} displayCards={board5} viewerLayout />);
    expect(html).toContain("container-type:inline-size");
    expect(html).toContain("3.9cqi"); // landscape hole-card width clamp (≈85% of board)
    expect(html).toContain("4.6cqi"); // landscape board-card width clamp
  });

  it("never leaks the container query into the operator/TV render (viewerLayout off)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait />);
    expect(html).not.toContain("cqi");
    expect(html).not.toContain("container-type");
  });

  it("viewer drops UNDEALT board slots (only dealt cards show); operator/TV keeps the backs; 2 per seat", () => {
    const dealt3 = ["Ah", "Kd", "Qc", "", ""]; // 3 dealt + 2 undealt
    const boardSeg = (html: string) =>
      (html.split('data-testid="board-cards"')[1] ?? "").split('data-testid="seat-holecards"')[0] ?? "";
    const backs = (seg: string) => (seg.match(/data-testid="card-back"/g) || []).length;
    const cards = (seg: string) => backs(seg) + (seg.match(/tracker-card-reveal/g) || []).length;

    const viewer = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait viewerLayout displayCards={dealt3} />);
    const operator = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait displayCards={dealt3} />);

    // VIEWER: the 2 undealt slots render nothing (they used to sit in front of the top-center
    // pods, covering stacks/chips) → only the 3 dealt community cards remain.
    expect(cards(boardSeg(viewer))).toBe(3);
    expect(backs(boardSeg(viewer))).toBe(0);
    // OPERATOR/TV: the 5-slot board is kept (undealt → V-logo backs) — byte-identical.
    expect(backs(boardSeg(operator))).toBe(2);
    // hole cards unaffected: exactly 2 per seat on the viewer.
    seatCardCounts(viewer).forEach((c) => expect(c).toBe(2));
  });

  it("viewer renders the brand V as an INVISIBLE spacer (transparent); operator/TV shows it", () => {
    const vSeg = (html: string) => (html.split('data-testid="felt-v"')[1] ?? "").slice(0, 200);
    const viewer = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} viewerLayout />);
    const operator = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    expect(vSeg(viewer)).toContain("color:transparent"); // hidden on the viewer (kept only for spacing)
    expect(vSeg(operator)).not.toContain("color:transparent"); // visible brand V on operator/TV
  });

  it("forces its own neon premium surface (independent of viewerNeon)", () => {
    // viewerLayout ON but viewerNeon OFF → still neon (primary rim), not burgundy gold.
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait viewerLayout viewerNeon={false} />);
    expect(html).toContain("--primary"); // neon rim/glow uses --primary
  });

  it("compact portrait keeps Total Pot centered and also keeps the status-bar pot", () => {
    const html = renderToStaticMarkup(
      <LiveFelt
        seats={seats}
        {...baseProps}
        potSize={2_000_000}
        portrait
        viewerLayout
        compact
      />,
    );
    expect(html).toContain('data-testid="felt-total-pot"');
    expect(html).toContain('data-testid="felt-status-bar"');
    expect((html.match(/2M/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

// RPT committed-bet indicator: viewerLayout shows the on-felt chip STACK (red all-in /
// emerald-labelled regular) and drops the standalone ALL IN label; the operator
// (viewerLayout off) shows NO stack even with current_bet populated (byte-identical) but
// keeps the ALL IN label. (Stack geometry is pinned in liveFeltChipStack.render.test.tsx.)
describe("LiveFelt RPT committed-bet chip stack colors (viewerLayout)", () => {
  it("all-in → red (rgb(184,31,31)) + ALL IN, and the standalone text-red-400 label is gone", () => {
    const s = [seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 12100000 })];
    const html = renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} portrait viewerLayout />);
    expect(html).toContain("rgb(184,31,31)"); // the red all-in label
    expect(html).toContain("ALL IN");
    expect(html).not.toContain("text-red-400"); // moved to the felt stack → no standalone label
  });

  it("regular committed bet → emerald label (not red)", () => {
    const s = [seat({ player_id: "a", seat_number: 1, current_bet: 200000 })];
    const html = renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} viewerLayout />);
    expect(html).toContain("146 62% 56%"); // emerald text/border
    expect(html).not.toContain("rgb(184,31,31)");
  });

  it("operator path (viewerLayout off) renders NO chip stack even with current_bet, keeps ALL IN label", () => {
    const s = [seat({ player_id: "a", seat_number: 1, is_all_in: true, current_bet: 999000 })];
    const html = renderToStaticMarkup(<LiveFelt seats={s} {...baseProps} />);
    expect(html).not.toContain("rgb(184,31,31)"); // no red stack
    expect(html).not.toContain("146 62% 56%"); // no emerald stack
    expect(html).toContain("text-red-400"); // the standalone ALL IN label stays (as today)
  });
});

// Phase 2 (gameplay-view): PODS scale with the felt like the cards (fixed 58/70px pods
// read ~8% of an 880px felt vs the N8 broadcast 12-15% band), and the VIEWER landscape
// reads the rim-tuned V3 seat map (top row ON the rim, bottom pair toward the rounded
// ends + clear of the status bar). Both are viewerLayout-gated: the operator/TV render
// keeps the fixed pod classes + the ORIGINAL LANDSCAPE_SEATS byte-identically.
describe("LiveFelt Phase-2 pod scaling + V3 seat map (viewerLayout)", () => {
  it("landscape: pod/avatar/nameplate carry the cqi clamps", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} viewerLayout />);
    expect(html).toContain("11cqi"); // pod width clamp(58px,11cqi,112px)
    expect(html).toContain("5.4cqi"); // avatar clamp(34px,5.4cqi,52px)
    expect(html).toContain("1.5cqi"); // nameplate font clamp(10px,1.5cqi,14px)
  });

  it("portrait: pod/avatar carry the portrait clamps", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait viewerLayout />);
    expect(html).toContain("15cqi"); // pod width clamp(56px,15cqi,84px)
    expect(html).toContain("8.5cqi"); // avatar clamp(32px,8.5cqi,44px)
  });

  it("viewer landscape positions seats on the V3 rim-tuned map", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} viewerLayout />);
    expect(html).toContain("left:29%"); // V3 slot 1 (was 35 on V2, 37 on operator)
    expect(html).toContain("top:82%"); // V3 slot 1 (bottom row raised off the status bar)
    expect(html).toContain("top:22%"); // V3 slot 3
  });

  it("operator landscape (viewerLayout off) keeps the ORIGINAL map + fixed pod size", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    expect(html).toContain("left:37%"); // LANDSCAPE_SEATS slot 1 unchanged
    expect(html).toContain("top:86%");
    expect(html).not.toContain("left:29%"); // V3 never leaks into the operator render
    expect(html).toContain("w-[58px]"); // fixed pod width class, no inline override
  });
});

// Phase 3: smoothness transitions + count-up are tableFx-gated. OFF (operator/TV and
// the viewer with liveTableFx disabled) the markup carries NO transition utilities and
// numbers render at their exact targets — byte-identical to today.
describe("LiveFelt Phase-3 smoothness gating (tableFx)", () => {
  const potProps = { ...baseProps, potSize: 1_234_000 };

  it("tableFx ON adds the fold-fade + ring-glide transitions", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...potProps} viewerLayout tableFx />);
    expect(html).toContain("transition-opacity");
    expect(html).toContain("transition-[border-color,box-shadow]");
    expect(html).toContain("motion-reduce:transition-none");
  });

  it("tableFx OFF renders no transition utilities and exact numbers", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...potProps} viewerLayout />);
    expect(html).not.toContain("transition-opacity");
    expect(html).not.toContain("transition-[border-color,box-shadow]");
    expect(html).toContain("1.2M"); // pot renders the exact target (no tween artifact)
  });

  it("static render with tableFx ON still emits exact target numbers (first-render sync)", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...potProps} viewerLayout tableFx />);
    expect(html).toContain("1.2M");
    expect(html).toContain("1k"); // seat chip_count (1000 → formatStack "1k") via CountUpText first render
  });
});
