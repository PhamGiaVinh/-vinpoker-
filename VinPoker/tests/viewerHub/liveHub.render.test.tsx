import { describe, it, expect, vi, beforeEach } from "vitest";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LiveHubHeader } from "@/components/cashier/tournament-live/viewer-hub/LiveHubHeader";
import { FeaturedTableCard } from "@/components/cashier/tournament-live/viewer-hub/FeaturedTableCard";

// Isolate LiveHub from its supabase-backed data hook — the hub composition is what
// we assert here, with stubbed hub data.
vi.mock("@/components/cashier/tournament-live/viewer-hub/useLiveTrackerData", () => ({
  useLiveTrackerData: () => ({
    liveTableCount: 2,
    tables: [
      { tableId: "tA", name: "Bàn 1", playerCount: 8 },
      { tableId: "tB", name: "Bàn 2", playerCount: 6 },
    ],
    feed: [{ id: "1", seatNumber: 2, playerName: "Bình", label: "ALL-IN 5k", kind: "allin" }],
    chipLeader: null,
    storyFeed: [],
    activeHandTableId: "tA",
    loading: false,
  }),
}));

// A MUTABLE copy of the real flags so we can flip liveEventTabs per test (ON = new
// 5-tab layout, OFF = legacy stacked felt) while keeping every other real flag.
vi.mock("@/lib/featureFlags", async (orig) => {
  const actual = (await orig()) as { FEATURES: Record<string, unknown> };
  return { ...actual, FEATURES: { ...actual.FEATURES } };
});

// eslint-disable-next-line import/first
import { LiveHub } from "@/components/cashier/tournament-live/viewer-hub/LiveHub";
// eslint-disable-next-line import/first
import { FEATURES } from "@/lib/featureFlags";

const noop = () => {};
const wrap = (node: ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

beforeEach(() => {
  (FEATURES as Record<string, unknown>).liveEventTabs = true;
  (FEATURES as Record<string, unknown>).liveHandFeed = true;
});

describe("Viewer Event Hub — header / featured card", () => {
  it("LiveHubHeader shows live badge, title, club link, share", () => {
    const html = wrap(<LiveHubHeader title="Main Event" clubName="CLB Sài Gòn" clubId="c1" onShare={noop} />);
    expect(html).toContain("TRỰC TIẾP");
    expect(html).toContain("Main Event");
    expect(html).toContain("CLB Sài Gòn");
    expect(html).toContain("/club/c1");
    expect(html).toContain("Chia sẻ");
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
});

describe("LiveHub — event-tabs layout (liveEventTabs ON)", () => {
  it("renders the 5 tabs and does NOT mount the felt at rest (default = Cập nhật)", () => {
    const html = wrap(
      <LiveHub tournamentId="t1" title="Daily Turbo" onShare={noop}>
        <div>LIVE_TABLE_VIEW</div>
      </LiveHub>
    );
    ["Cập nhật", "Lịch sử ván", "Giải thưởng", "Cấu trúc", "Hình ảnh"].forEach((label) => expect(html).toContain(label));
    expect(html).not.toContain("LIVE_TABLE_VIEW"); // felt is on-demand, not mounted by default
    expect(html).toContain("ALL-IN 5k"); // Cập nhật is the active tab → its feed renders
    expect(html).toContain("Bàn đang chơi"); // tappable live-table card
  });

  it("a ?hand deep-link opens the replay felt with the spectator + hand props injected", () => {
    const Viewer = ({ spectator, initialReplayHandNumber }: { spectator?: boolean; initialReplayHandNumber?: number | null }) => (
      <div>FELT spec:{String(spectator)} hand:{initialReplayHandNumber}</div>
    );
    const html = wrap(
      <LiveHub tournamentId="t1" title="X" initialReplayHandNumber={7} onShare={noop}>
        <Viewer />
      </LiveHub>
    );
    expect(html).toContain("PHÁT LẠI VÁN"); // replay badge
    expect(html).toContain("FELT spec:true hand:7");
    expect(html).not.toContain("Lịch sử ván"); // tabs hidden while watching
  });
});

describe("LiveHub — legacy stacked layout (liveEventTabs OFF) stays intact", () => {
  it("renders the felt + featured badge + orientation toggle", () => {
    (FEATURES as Record<string, unknown>).liveEventTabs = false;
    const html = wrap(
      <LiveHub tournamentId="t1" title="Daily Turbo" onShare={noop}>
        <div>LIVE_TABLE_VIEW</div>
      </LiveHub>
    );
    expect(html).toContain("LIVE_TABLE_VIEW");
    expect(html).toContain("BÀN ĐANG DIỄN RA");
    expect(html).toContain("Ngang");
    expect(html).toContain("Dọc");
  });

  it("injects orientation + spectator overrides into the child viewer", () => {
    (FEATURES as Record<string, unknown>).liveEventTabs = false;
    const Viewer = ({ orientationOverride, spectator }: { orientationOverride?: "landscape" | "portrait" | null; spectator?: boolean }) => (
      <div>ORIENT:{orientationOverride}|SPECTATOR:{String(spectator)}</div>
    );
    const html = wrap(
      <LiveHub tournamentId="t1" title="X" onShare={noop}>
        <Viewer />
      </LiveHub>
    );
    expect(html).toContain("ORIENT:landscape");
    expect(html).toContain("SPECTATOR:true");
  });
});
