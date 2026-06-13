import { describe, expect, it } from "vitest";
import { normalize, searchRules } from "./localSearch";
import { MOCK_TD_RULES } from "./mockRules";

function topId(query: string): string | undefined {
  return searchRules(query, MOCK_TD_RULES)[0]?.rule.id;
}

describe("normalize", () => {
  it("strips Vietnamese diacritics and đ", () => {
    expect(normalize("Đặt cược chuỗi")).toBe("dat cuoc chuoi");
    expect(normalize("Hành động sai lượt")).toBe("hanh dong sai luot");
    expect(normalize("Bài bị lộ!")).toBe("bai bi lo");
  });
  it("lowercases and collapses punctuation/whitespace", () => {
    expect(normalize("  STRING   bet!! ")).toBe("string bet");
  });
});

describe("searchRules", () => {
  it("matches a Vietnamese query to the Vietnamese rule", () => {
    expect(topId("khách đặt cược chuỗi nhiều lần")).toBe("string-bet");
    expect(topId("người chơi hành động sai lượt")).toBe("action-out-of-turn");
  });

  it("matches an English keyword to the Vietnamese rule via synonyms", () => {
    expect(topId("string bet")).toBe("string-bet");
    expect(topId("exposed card")).toBe("exposed-card");
    expect(topId("misdeal")).toBe("misdeal");
    expect(topId("player away from table")).toBe("player-away");
  });

  it("surfaces the expected top rule for common disputes", () => {
    expect(topId("all in side pot tách hũ phụ")).toBe("all-in-side-pot");
    expect(topId("chip lẻ chia đôi pot")).toBe("odd-chip");
    expect(topId("dealer lật flop sớm")).toBe("premature-board-card");
    expect(topId("muck nhầm bài thắng")).toBe("kill-winning-hand");
  });

  it("returns empty for an unrelated / empty query", () => {
    expect(searchRules("", MOCK_TD_RULES)).toEqual([]);
    expect(searchRules("xin chào ăn tối", MOCK_TD_RULES)).toEqual([]);
  });

  it("orders hits by descending score", () => {
    const hits = searchRules("string bet đặt cược chuỗi", MOCK_TD_RULES);
    expect(hits.length).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
    }
    expect(hits[0].rule.id).toBe("string-bet");
  });
});
