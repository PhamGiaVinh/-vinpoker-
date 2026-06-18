// P0 LIVE/REPLAY clarity: the replay-mode awareness banner on the public viewer.
// It is rendered ONLY in replay mode (gated by `{isReplay && ...}` in
// TournamentLiveView), so the default LIVE spectator render is unchanged.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReplayLiveBanner } from "@/components/cashier/tournament-live/ReplayLiveBanner";

const noop = () => {};

describe("ReplayLiveBanner", () => {
  it("calm notice (no new activity): paused-updates copy + a single 'Xem trực tiếp' action", () => {
    const html = renderToStaticMarkup(
      <ReplayLiveBanner hasNewActivity={false} newActionCount={null} onGoLive={noop} />
    );
    expect(html).toContain("Chế độ replay");
    expect(html).toContain("tạm dừng cập nhật");
    expect(html).toContain("Xem trực tiếp");
    expect(html).not.toContain("Bản ghi mới");
    expect(html).toContain('role="status"'); // announced without stealing focus
  });

  it("new activity with a same-hand count: shows how many actions happened", () => {
    const html = renderToStaticMarkup(
      <ReplayLiveBanner hasNewActivity newActionCount={3} onGoLive={noop} />
    );
    expect(html).toContain("Bản ghi mới: 3 hành động vừa diễn ra.");
    expect(html).toContain("Xem trực tiếp");
    expect(html).toContain('role="status"');
  });

  it("new activity without a meaningful count (new hand): generic live prompt", () => {
    const html = renderToStaticMarkup(
      <ReplayLiveBanner hasNewActivity newActionCount={null} onGoLive={noop} />
    );
    expect(html).toContain("Có diễn biến live mới");
    expect(html).not.toContain("Bản ghi mới");
    expect(html).toContain("Xem trực tiếp");
  });

  it("a zero same-hand delta is not dressed up as a count", () => {
    const html = renderToStaticMarkup(
      <ReplayLiveBanner hasNewActivity newActionCount={0} onGoLive={noop} />
    );
    expect(html).toContain("Có diễn biến live mới");
    expect(html).not.toContain("Bản ghi mới");
  });
});
