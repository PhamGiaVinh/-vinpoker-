import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { BaselineBatteryCard, verdictText, VERDICT_TONE } from "../BaselineBatteryCard";
import type { BaselineBatteryResult } from "@/lib/series-intelligence/baselineBattery";

afterEach(cleanup);

const nfc = (s: string) => s.normalize("NFC");
const bodyText = () => document.body.textContent!.normalize("NFC");
const has = (s: string) => bodyText().includes(nfc(s));

// Phrases the honesty doctrine forbids in this surface.
const BANNED = ["AI chắc chắn tốt hơn", "chắc chắn", "được đảm bảo", "đảm bảo", "Model thắng"];

function result(over: Partial<BaselineBatteryResult> = {}): BaselineBatteryResult {
  return {
    forecasts: [],
    scores: [
      { baselineId: "historical_median", foldCount: 6, mape: 12.34, mae: 20 },
      { baselineId: "trailing_mean", foldCount: 6, mape: 15, mae: 25 },
      { baselineId: "same_weekday", foldCount: 0, mape: null, mae: null },
      { baselineId: "existing_naive", foldCount: 6, mape: 18, mae: 30 },
    ],
    bestBaselineId: "historical_median",
    targets: [
      { baselineId: "historical_median", forecast: 128, unavailableReason: null },
      { baselineId: "trailing_mean", forecast: 131, unavailableReason: null },
      { baselineId: "same_weekday", forecast: null, unavailableReason: "NO_SAME_WEEKDAY" },
      { baselineId: "existing_naive", forecast: 125, unavailableReason: null },
    ],
    comparisons: [
      { baselineId: "historical_median", conclusive: false, foldCount: 3, modelMape: 10, baselineMape: 12, modelBeatsBaseline: false },
    ],
    ...over,
  };
}

describe("BaselineBatteryCard — renders the compact Vietnamese card", () => {
  it("shows the title, the model, every baseline label and the target predictions", () => {
    render(<BaselineBatteryCard battery={result()} modelBase={134} modelMapePct={10} />);
    expect(has("Mốc dự báo đơn giản")).toBe(true);
    expect(has("Mô hình")).toBe(true);
    expect(has("134")).toBe(true);
    expect(has("Trung vị lịch sử")).toBe(true);
    expect(has("128")).toBe(true); // historical-median target prediction
    expect(has("Cùng thứ trong tuần")).toBe(true);
  });

  it("an unavailable baseline shows 'chưa có' — never a fake 0", () => {
    render(<BaselineBatteryCard battery={result()} modelBase={134} modelMapePct={10} />);
    expect(has("chưa có")).toBe(true); // same_weekday target is null
  });

  it("insufficient / inconclusive data renders the honest message (no win claim)", () => {
    render(<BaselineBatteryCard battery={result()} modelBase={134} modelMapePct={10} />);
    expect(has("Chưa đủ dữ liệu để kết luận mô hình tốt hơn mốc đơn giản")).toBe(true);
    expect(has("tốt hơn mốc đơn giản tốt nhất")).toBe(false); // no superiority claim
  });

  it("conclusive win renders 'tốt hơn' only when the model actually wins", () => {
    const r = result({
      comparisons: [{ baselineId: "historical_median", conclusive: true, foldCount: 6, modelMape: 8, baselineMape: 12, modelBeatsBaseline: true }],
    });
    render(<BaselineBatteryCard battery={r} modelBase={134} modelMapePct={8} />);
    expect(has("mô hình đang tốt hơn mốc đơn giản tốt nhất")).toBe(true);
  });

  it("no causal / guaranteed-accuracy language in ANY verdict state", () => {
    for (const kind of ["inconclusive", "model_better", "model_not_ahead"] as const) {
      const text = nfc(
        verdictText(
          kind === "inconclusive"
            ? { kind, baselineId: null, foldCount: 0 }
            : { kind, baselineId: "historical_median", foldCount: 6 },
        ),
      );
      for (const bad of BANNED) expect(text.includes(nfc(bad))).toBe(false);
    }
    // and in the rendered DOM of the default (inconclusive) card
    render(<BaselineBatteryCard battery={result()} modelBase={134} modelMapePct={10} />);
    for (const bad of BANNED) expect(has(bad)).toBe(false);
  });

  it("verdict tone map covers every kind", () => {
    expect(Object.keys(VERDICT_TONE).sort()).toEqual(["inconclusive", "model_better", "model_not_ahead"].sort());
  });
});
