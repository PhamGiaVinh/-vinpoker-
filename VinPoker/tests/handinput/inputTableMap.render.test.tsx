import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InputTableMap, type InputTableSummary } from "@/components/cashier/tournament-live/handinput/InputTableMap";

const tables: InputTableSummary[] = [
  { id: "tA", name: "Bàn 1", playerCount: 8, hasLiveHand: true },
  { id: "tB", name: "Bàn 2", playerCount: 6, hasLiveHand: false },
];

describe("InputTableMap (operator table picker)", () => {
  it("renders a tile per table with name, player count, picker title + active highlight", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={tables} activeTableId="tA" onSelect={() => {}} />
    );
    expect(html).toContain("Chọn bàn để nhập hand"); // picker title (vi)
    expect(html).toContain("Bàn 1");
    expect(html).toContain("Bàn 2");
    expect(html).toContain("8 người chơi");
    expect(html).toContain("6 người chơi");
    expect(html).toContain("<svg"); // the table-logo icon
    expect(html).toContain('aria-pressed="true"'); // tA is the active tile
    expect(html).toContain('aria-pressed="false"'); // tB is not active
  });

  it("shows the live-hand badge ONLY for tables with an in-progress hand", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={tables} activeTableId={null} onSelect={() => {}} />
    );
    // Only tA has hasLiveHand → exactly one "đang có hand" badge.
    expect((html.match(/đang có hand/g) || []).length).toBe(1);
  });

  it("renders even for a SINGLE table (unlike the spectator map, which hides)", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={[tables[0]]} activeTableId={null} onSelect={() => {}} />
    );
    expect(html).not.toBe("");
    expect(html).toContain("Bàn 1");
  });

  it("shows an empty state when there are no tables", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={[]} activeTableId={null} onSelect={() => {}} />
    );
    expect(html).toContain("Chưa có bàn nào");
  });

  it("does not present a table-load failure as an empty tournament", () => {
    const html = renderToStaticMarkup(
      <InputTableMap
        tables={[]}
        activeTableId={null}
        onSelect={() => {}}
        loadState="error"
        loadError="Không thể tải danh sách bàn."
        onRetry={() => {}}
      />
    );

    expect(html).toContain("Không thể tải danh sách bàn.");
    expect(html).toContain("Thử lại");
    expect(html).not.toContain("Chưa có bàn nào");
  });

  it("keeps the loading state distinct from both errors and empty results", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={[]} activeTableId={null} onSelect={() => {}} loadState="loading" />
    );

    expect(html).toContain("Đang tải danh sách bàn");
    expect(html).not.toContain("Chưa có bàn nào");
  });

  it("explains a routed tournament that is not found without presenting an empty table list", () => {
    const html = renderToStaticMarkup(
      <InputTableMap tables={[]} activeTableId={null} onSelect={() => {}} loadState="not_found" />
    );

    expect(html).toContain("Không tìm thấy giải hoặc bạn không có quyền truy cập.");
    expect(html).not.toContain("Chưa có bàn nào");
  });

  it("keeps an invalid routed table visible as a scoped selection notice", () => {
    const html = renderToStaticMarkup(
      <InputTableMap
        tables={tables}
        activeTableId={null}
        onSelect={() => {}}
        selectionNotice="Bàn được yêu cầu không thuộc giải đang mở."
      />
    );

    expect(html).toContain("Bàn được yêu cầu không thuộc giải đang mở.");
    expect(html).toContain("Bàn 1");
  });

  // B3 (trackerMultiTable): lock visibility + stale-lock takeover row.
  it("shows the holder chip when a table is locked by someone else", () => {
    const locked: InputTableSummary[] = [
      { id: "tA", name: "Bàn 1", playerCount: 8, hasLiveHand: true, lockHandId: "h1", lockedByName: "TĐ Minh", lockedByOther: true, lockAgeMin: 2, lockStale: false },
      { id: "tB", name: "Bàn 2", playerCount: 6, hasLiveHand: false },
    ];
    const html = renderToStaticMarkup(<InputTableMap tables={locked} activeTableId={null} onSelect={() => {}} />);
    expect(html).toContain("TĐ Minh");
    expect(html).toContain("2 phút");
  });

  it("renders a 'Tiếp quản' row ONLY for a STALE lock and ONLY when onTakeover is wired", () => {
    const stale: InputTableSummary[] = [
      { id: "tA", name: "Bàn 1", playerCount: 8, hasLiveHand: true, lockHandId: "h1", lockedByName: "TĐ Minh", lockedByOther: true, lockAgeMin: 7, lockStale: true },
      { id: "tB", name: "Bàn 2", playerCount: 6, hasLiveHand: true, lockHandId: "h2", lockedByName: "TĐ An", lockedByOther: true, lockAgeMin: 1, lockStale: false },
    ];
    // No onTakeover → no takeover row even for the stale one.
    const noCb = renderToStaticMarkup(<InputTableMap tables={stale} activeTableId={null} onSelect={() => {}} />);
    expect(noCb).not.toContain("Tiếp quản");
    // With onTakeover → exactly the stale table gets a takeover row (the fresh one doesn't).
    const withCb = renderToStaticMarkup(<InputTableMap tables={stale} activeTableId={null} onSelect={() => {}} onTakeover={() => {}} />);
    expect((withCb.match(/Tiếp quản/g) || []).length).toBe(1);
    expect(withCb).toContain("(treo)");
  });
});
