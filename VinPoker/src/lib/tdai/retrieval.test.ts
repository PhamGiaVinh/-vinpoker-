import { describe, expect, it } from "vitest";
import { retrieveRules, situationToQuery } from "./retrieval";
import { TD_RULES_CORPUS } from "./corpus";
import type { TdSituation } from "./types";

const sit = (description: string, extra: Partial<TdSituation> = {}): TdSituation => ({
  description,
  ...extra,
});

function topId(description: string): string | undefined {
  return retrieveRules(sit(description), TD_RULES_CORPUS).hits[0]?.rule.id;
}

describe("situationToQuery", () => {
  it("joins the populated situation fields", () => {
    expect(situationToQuery(sit("string bet", { actionSequence: "raise nhiều lần", tableLabel: "Bàn 4" })))
      .toBe("string bet raise nhiều lần Bàn 4");
  });
});

describe("retrieveRules — golden set", () => {
  const cases: Array<[string, string]> = [
    ["khách đặt cược chuỗi nhiều lần", "string-bet"],
    ["string bet", "string-bet"],
    ["người chơi hành động sai lượt", "action-out-of-turn"],
    ["out of turn", "action-out-of-turn"],
    ["bài bị lộ khi chia", "exposed-card"],
    ["exposed card", "exposed-card"],
    ["tuyên bố miệng có hiệu lực không", "verbal-declaration"],
    ["muck nhầm bài thắng", "kill-winning-hand"],
    ["chip lẻ khi chia đôi pot", "odd-chip"],
    ["misdeal chia lại", "misdeal"],
    ["all in side pot tách hũ phụ", "all-in-side-pot"],
    ["ngồi sai ghế", "wrong-seat"],
    ["dealer lật flop sớm", "premature-board-card"],
    ["khách rời bàn khi tới lượt", "player-away"],
    ["mức raise không rõ ràng", "unclear-raise"],
    ["khách nghe điện thoại tại bàn", "house-phone-at-table"],
    ["gọi giờ clock call", "house-clock-call"],
    ["án phạt penalty cho khách", "house-penalty"],
  ];
  it.each(cases)("%s → %s", (q, expected) => {
    expect(topId(q)).toBe(expected);
  });

  it("flags below-threshold for an unrelated query (no LLM call)", () => {
    const r = retrieveRules(sit("xin chào ăn tối nay"), TD_RULES_CORPUS);
    expect(r.belowThreshold).toBe(true);
  });

  it("returns confident hits above threshold for a real dispute", () => {
    const r = retrieveRules(sit("string bet đặt cược chuỗi"), TD_RULES_CORPUS);
    expect(r.belowThreshold).toBe(false);
    expect(r.hits.length).toBeGreaterThan(0);
    expect(r.hits.length).toBeLessThanOrEqual(8);
  });
});
