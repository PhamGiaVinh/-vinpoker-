import { describe, it, expect, vi } from "vitest";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LiveHubHeader } from "@/components/cashier/tournament-live/viewer-hub/LiveHubHeader";
import { FeaturedTableCard } from "@/components/cashier/tournament-live/viewer-hub/FeaturedTableCard";

// Isolate LiveHub from its supabase-backed data hook (Increment B) — the hub
// composition is what we assert here, with stubbed hub data.
vi.mock("@/components/cashier/tournament-live/viewer-hub/useLiveTrackerData", () => ({
  useLiveTrackerData: () => ({
    liveTableCount: 2,
    tables: [
      { tableId: "tA", name: "Bàn 1", playerCount: 8 },
      { tableId: "tB", name: "Bàn 2", playerCount: 6 },
    ],
    feed: [{ id: "1", seatNumber: 2, playerName: "Bình", label: "ALL-IN 5k", kind: "allin" }],
    loading: false,
  }),
}));

// eslint-disable-next-line import/first
import { LiveHub } from "@/components/cashier/tournament-live/viewer-hub/LiveHub";

const noop = () => {};
const wrap = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

describe("Viewer Event Hub — Increment A (presentational)", () => {
  it("LiveHubHeader shows live badge, title, club link, share", () => {
    const html = wrap(
      <LiveHubHeader title="Main Event" clubName="CLB Sài Gòn" clubId="c1" onShare={noop} />
    );
    expect(html).toContain("TRỰC TIẾP");
    expect(html).toContain("Main Event");
    expect(html).toContain("CLB Sài Gòn");
    expect(html).toContain("/club/c1");
    expect(html).toContain("Chia sẻ");
  });

  it("LiveHubHeader prefers subtitle over club link when provided", () => {
    const html = wrap(
      <LiveHubHeader title="X" clubName="Club" clubId="c1" subtitle="Level 12" onShare={noop} />
    );
    expect(html).toContain("Level 12");
    expect(html).not.toContain("/club/c1");
  });

  it("FeaturedTableCard frames children + badge + footer", () => {
    const html = renderToStaticMarkup(
      <FeaturedTableCard badge="TRỰC TIẾP • BÀN 1" footer={<span>Xem tất cả bàn</span>}>
        <div>FELT_HERE</div>
      </FeaturedTableCard>
    );
    expect(html).toContain("TRỰC TIẾP • BÀN 1");
    expect(html).toContain("FELT_HERE");
    expect(html).toContain("Xem tất cả bàn");
  });

  it("LiveHub composes header (count) + featured card + tables strip + feed", () => {
    const html = wrap(
      <LiveHub tournamentId="t1" title="Daily Turbo" clubName="CLB Hà Nội" clubId="c2" onShare={noop}>
        <div>LIVE_TABLE_VIEW</div>
      </LiveHub>
    );
    expect(html).toContain("Daily Turbo");
    expect(html).toContain("BÀN ĐANG DIỄN RA");
    expect(html).toContain("LIVE_TABLE_VIEW"); // featured felt (children)
    expect(html).toContain("2 bàn"); // header live-table count
    expect(html).toContain("Bàn 2"); // all-tables strip
    expect(html).toContain("Cập nhật"); // live updates feed
    expect(html).toContain("ALL-IN 5k"); // feed row
    expect(html).toContain("Ngang"); // orientation toggle
    expect(html).toContain("Dọc");
  });

  it("LiveHub injects the orientation override into the child viewer (Ngang/Dọc wiring)", () => {
    // The real child is <TournamentLiveView/>, which consumes orientationOverride
    // (presentational only). Use a stub to assert the prop is actually passed.
    const Viewer = ({ orientationOverride }: { orientationOverride?: "landscape" | "portrait" | null }) => (
      <div>ORIENT:{orientationOverride}</div>
    );
    const html = wrap(
      <LiveHub tournamentId="t1" title="X" onShare={noop}>
        <Viewer />
      </LiveHub>
    );
    // SSR (no mobile media match) → defaults to landscape.
    expect(html).toContain("ORIENT:landscape");
  });
});
