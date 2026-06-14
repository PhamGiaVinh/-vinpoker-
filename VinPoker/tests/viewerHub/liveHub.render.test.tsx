import { describe, it, expect } from "vitest";
import { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { LiveHubHeader } from "@/components/cashier/tournament-live/viewer-hub/LiveHubHeader";
import { FeaturedTableCard } from "@/components/cashier/tournament-live/viewer-hub/FeaturedTableCard";
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

  it("LiveHub composes header + featured card around children", () => {
    const html = wrap(
      <LiveHub title="Daily Turbo" clubName="CLB Hà Nội" clubId="c2" onShare={noop}>
        <div>LIVE_TABLE_VIEW</div>
      </LiveHub>
    );
    expect(html).toContain("Daily Turbo");
    expect(html).toContain("BÀN ĐANG DIỄN RA");
    expect(html).toContain("LIVE_TABLE_VIEW");
  });
});
