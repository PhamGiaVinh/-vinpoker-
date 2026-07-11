import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { HonestForecastView } from "../HonestForecastView";
import type { HonestForecastResult } from "@/lib/series-intelligence/honestForecast";

afterEach(cleanup);

const nfc = (s: string) => s.normalize("NFC");
const bodyText = () => document.body.textContent!.normalize("NFC");
const has = (s: string) => bodyText().includes(nfc(s));

// Copy / framings the honesty doctrine forbids on this surface.
const BANNED = ["0 khách", "Độ bất định tối đa", "bất định tối đa", "AI không biết", "Model chắc chắn đúng", "chắc chắn"];

const unavailable: HonestForecastResult = { status: "unavailable", reasons: ["NO_HISTORY"], forecast: null, baseline: null };
const baselineOnly = (foldCount: number): HonestForecastResult => ({
  status: "baseline_only",
  reasons: ["NO_HISTORY"],
  forecast: null,
  baseline: { baselineId: "historical_median", forecast: 128, foldCount },
});

describe("HonestForecastView — unavailable", () => {
  it("renders a plain-Vietnamese WHY + WHAT-is-needed explainer (never a fabricated number)", () => {
    render(<HonestForecastView result={unavailable} />);
    expect(has("Chưa đủ dữ liệu lịch sử để dự báo")).toBe(true);
    expect(has("Nạp thêm các giải đã chạy")).toBe(true); // what data is needed
    for (const bad of BANNED) expect(has(bad)).toBe(false);
  });
});

describe("HonestForecastView — baseline_only", () => {
  it("is CLEARLY labelled a reference, shows baseline name + value + fold count, and is not the model", () => {
    render(<HonestForecastView result={baselineOnly(0)} />);
    expect(has("Mốc tham khảo")).toBe(true); // explicit reference label
    expect(has("Hiện chỉ hiển thị mốc tham khảo đơn giản")).toBe(true);
    expect(has("Trung vị lịch sử")).toBe(true); // baseline name (from BASELINE_LABEL)
    expect(has("128")).toBe(true); // its value (never 0)
    expect(has("chưa kiểm chứng")).toBe(true); // fold count = 0 shown honestly
    expect(has("Mốc này chưa phải dự báo từ mô hình")).toBe(true); // no model-skill claim
    for (const bad of BANNED) expect(has(bad)).toBe(false);
  });

  it("shows the walk-forward fold count when the baseline was validated", () => {
    render(<HonestForecastView result={baselineOnly(6)} />);
    expect(has("6 lần kiểm chứng")).toBe(true);
  });
});

describe("HonestForecastView — full_model renders nothing (panel keeps the existing card)", () => {
  it("returns null for full_model", () => {
    const full = {
      status: "full_model" as const,
      reasons: [] as const,
      // minimal TurnoutForecast-shaped object; the component must not render it
      forecast: {
        available: true, base: 134, low: 100, high: 170, confidence: "high" as const, sampleSize: 12, degraded: false,
        modelMapePct: 8, baselineMapePct: 20, deltaVsBaselinePct: 12, coefContributions: [], missingDataNotes: [], disclaimer: "d",
      },
      baseline: null,
    };
    const { container } = render(<HonestForecastView result={full} />);
    expect(container.textContent).toBe("");
  });
});
