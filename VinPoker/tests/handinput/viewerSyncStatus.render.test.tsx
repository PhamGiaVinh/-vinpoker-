import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ViewerSyncStatus, type SyncPhase } from "@/components/cashier/tournament-live/handinput/ViewerSyncStatus";

const render = (phase: SyncPhase, lastLabel: string | null = null) =>
  renderToStaticMarkup(<ViewerSyncStatus phase={phase} lastLabel={lastLabel} />);

describe("ViewerSyncStatus (pure UI sync state)", () => {
  it("idle makes NO affirmative 'sent' claim", () => {
    const html = render("idle");
    expect(html).toContain("Sẵn sàng đồng bộ viewer");
    expect(html).not.toContain("Đã gửi");
  });

  it("sending shows the in-flight message", () => {
    const html = render("sending", "S2 raise");
    expect(html).toContain("Đang gửi lên viewer");
  });

  it("sent shows the confirmation and the last-persisted label", () => {
    const html = render("sent", "S2 Raise 5,000");
    expect(html).toContain("Đã gửi lên viewer");
    expect(html).toContain("S2 Raise 5,000");
  });

  it("error shows a retry prompt and an alert role", () => {
    const html = render("error");
    expect(html).toContain("Lỗi gửi");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain("Đã gửi");
  });
});
