// LiveFelt is SHARED by the public /live viewer, the operator surfaces and replay.
// The operator console adds two ADDITIVE props (onSeatClick, selectedSeat). These
// tests are the tripwire that the public/replay render stays byte-identical when
// those props are absent, and that the seat only becomes interactive when wired.

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

const seats = [seat({ player_id: "a", seat_number: 1 }), seat({ player_id: "b", seat_number: 2 })];

describe("LiveFelt additive operator props", () => {
  it("renders byte-identical with no operator props vs explicit defaults (selectedSeat=null)", () => {
    const plain = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    const defaults = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} selectedSeat={null} />);
    expect(defaults).toBe(plain);
  });

  it("Viewer Felt V2 is fully gated: viewerLayout absent === viewerLayout={false} (operator byte-identical)", () => {
    const plain = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    const off = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} viewerLayout={false} />);
    expect(off).toBe(plain);
    // And the V2 container query / cqi sizing never appears in the operator render.
    expect(plain).not.toContain("cqi");
    expect(plain).not.toContain("container-type");
  });

  it("operator render shows no colored-chip surfaces even with current_bet populated", () => {
    // liveActionEngine is now ON, so the operator's seats can carry current_bet — but the
    // RPT pill + chip color are viewer-only, so the operator render must stay pill-less.
    const live = [seat({ player_id: "a", seat_number: 1, current_bet: 500, is_all_in: true })];
    const html = renderToStaticMarkup(<LiveFelt seats={live} {...baseProps} />);
    expect(html).not.toContain("rgb(184,31,31)"); // no red all-in pill
    expect(html).not.toContain("146 62% 56%"); // no emerald committed pill
    expect(html).not.toContain("--chip-color"); // no flying-chip color (no chipPush)
  });

  it("the public/replay render (no onSeatClick) puts NO button role or selection frame on seats", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} />);
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain("ring-emerald-400");
    expect(html).not.toContain("cursor-pointer");
  });

  it("each seat becomes a keyboard-operable button only when onSeatClick is supplied", () => {
    const html = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} onSeatClick={() => {}} />);
    expect((html.match(/role="button"/g) || []).length).toBe(2); // one per seat
    expect(html).toContain("cursor-pointer");
  });

  it("the selected seat (and only it) gets the distinct emerald frame", () => {
    const html = renderToStaticMarkup(
      <LiveFelt seats={seats} {...baseProps} onSeatClick={() => {}} selectedSeat={2} />
    );
    expect((html.match(/ring-emerald-400/g) || []).length).toBe(1);
    expect(html).toContain('aria-pressed="true"'); // the selected seat reports pressed
  });

  // PR-A1 (liveFeltCompact) — the compact prop is DOUBLE-gated on viewerLayout, so even a
  // leaked compact={true} can never change the operator/TV render (viewerLayout off).
  it("compact is inert without viewerLayout: operator render byte-identical even with compact+blinds", () => {
    const plain = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait />);
    const leaked = renderToStaticMarkup(
      <LiveFelt seats={seats} {...baseProps} portrait compact blinds={{ sb: 100, bb: 200, ante: 25 }} />
    );
    expect(leaked).toBe(plain);
    expect(plain).not.toContain("felt-status-bar");
    expect(plain).toContain("5 / 7"); // portrait racetrack aspect untouched
  });

  it("compact absent === compact={false} on the V2 viewer render (flag-OFF byte-identical)", () => {
    const plain = renderToStaticMarkup(<LiveFelt seats={seats} {...baseProps} portrait viewerLayout />);
    const off = renderToStaticMarkup(
      <LiveFelt seats={seats} {...baseProps} portrait viewerLayout compact={false} />
    );
    expect(off).toBe(plain);
    expect(plain).not.toContain("felt-status-bar");
    expect(plain).not.toContain("2.2 / 1");
  });
});
