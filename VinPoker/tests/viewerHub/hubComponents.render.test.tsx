import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LiveTablesStrip } from "@/components/cashier/tournament-live/viewer-hub/LiveTablesStrip";
import { LiveUpdatesFeed } from "@/components/cashier/tournament-live/viewer-hub/LiveUpdatesFeed";
import { OrientationToggle } from "@/components/cashier/tournament-live/viewer-hub/OrientationToggle";
import { LiveStatsBar } from "@/components/cashier/tournament-live/viewer-hub/LiveStatsBar";
import type { HubFeedItem, HubTableSummary } from "@/components/cashier/tournament-live/viewer-hub/hubDerive";

const tables: HubTableSummary[] = [
  { tableId: "tA", name: "Bàn 1", playerCount: 8 },
  { tableId: "tB", name: "Bàn 2", playerCount: 6 },
];

describe("LiveTablesStrip", () => {
  it("renders a mini card per table when >1 table", () => {
    const html = renderToStaticMarkup(<LiveTablesStrip tables={tables} activeTableId="tA" />);
    expect(html).toContain("Bàn 1");
    expect(html).toContain("Bàn 2");
    expect(html).toContain("8 người chơi");
  });
  it("renders nothing for a single table", () => {
    const html = renderToStaticMarkup(<LiveTablesStrip tables={[tables[0]]} />);
    expect(html).toBe("");
  });
});

describe("LiveUpdatesFeed", () => {
  const feed: HubFeedItem[] = [
    { id: "1", seatNumber: 2, playerName: "Bình", label: "ALL-IN 5k", kind: "allin" },
    { id: "2", seatNumber: 1, playerName: "An", label: "Theo 2.4k", kind: "call" },
  ];
  it("renders feed rows with badges", () => {
    const html = renderToStaticMarkup(<LiveUpdatesFeed feed={feed} />);
    expect(html).toContain("Cập nhật");
    expect(html).toContain("Bình");
    expect(html).toContain("ALL-IN 5k");
    expect(html).toContain("ALL-IN"); // badge
    expect(html).toContain("Ghế 2");
  });
  it("shows an empty state when no actions", () => {
    const html = renderToStaticMarkup(<LiveUpdatesFeed feed={[]} />);
    expect(html).toContain("Chưa có hành động");
  });
});

describe("OrientationToggle (UI-only)", () => {
  it("renders both orientations, defaulting to landscape selected", () => {
    const html = renderToStaticMarkup(<OrientationToggle />);
    expect(html).toContain("Ngang");
    expect(html).toContain("Dọc");
    expect(html).toContain('aria-pressed="true"'); // default landscape is pressed
  });
});

describe("LiveStatsBar", () => {
  it("renders prize pool, players remaining and chip leader when present", () => {
    const html = renderToStaticMarkup(
      <LiveStatsBar
        prizePool={48_000_000}
        playersRemaining={27}
        chipLeader={{ playerName: "Bình", seatNumber: 5, chipCount: 1_500_000 }}
      />
    );
    expect(html).toContain("Giải thưởng");
    expect(html).toContain("48M"); // prize pool, compact
    expect(html).toContain("Còn lại");
    expect(html).toContain("27"); // players remaining
    expect(html).toContain("Chip Leader");
    expect(html).toContain("Bình");
    expect(html).toContain("Ghế 5");
    expect(html).toContain("1.5M"); // leader stack, compact
  });

  it("hides a stat whose data is missing", () => {
    const html = renderToStaticMarkup(<LiveStatsBar prizePool={null} playersRemaining={12} chipLeader={null} />);
    expect(html).toContain("Còn lại");
    expect(html).not.toContain("Giải thưởng");
    expect(html).not.toContain("Chip Leader");
  });

  it("renders nothing when there is no data at all", () => {
    const html = renderToStaticMarkup(<LiveStatsBar prizePool={0} playersRemaining={null} chipLeader={null} />);
    expect(html).toBe("");
  });
});
