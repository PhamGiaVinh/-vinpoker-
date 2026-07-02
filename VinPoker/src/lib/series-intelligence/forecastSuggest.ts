// Series Intelligence — forecast SUGGESTION from the club's own history. PURE (no I/O).
//
// The owner records a pre-event forecast by hand; this offers a starting point drawn ONLY from COMPARABLE past
// events (same buy-in band), never a blended median across a bimodal field of very different event sizes. When
// there are too few comparable finished events it returns `insufficient` ("chưa đủ dữ liệu") instead of a shaky
// number. This is a SUGGESTION the owner edits — it is never auto-saved, and it is an Observed-Pattern reading of
// real turnouts, NOT a model prediction.
import type { SeriesEvent } from "./nativeData";

export type SuggestStatus = "ok" | "insufficient";

export interface ForecastSuggestion {
  status: SuggestStatus;
  low: number | null;
  base: number | null;
  high: number | null;
  sampleSize: number;
  comparableEventIds: string[];
  /** Buy-in band actually used to pick comparable events (null when the target's buy-in is unknown). */
  bandLow: number | null;
  bandHigh: number | null;
  /** Plain-Vietnamese basis / reason (measured facts, or why it can't suggest). */
  reason: string;
}

export interface ForecastSuggestOptions {
  /** Multiplicative half-width of the buy-in band; default 2 → compare events within 0.5×–2× the buy-in. */
  buyInBand?: number;
  /** Minimum comparable events when a buy-in band is available (default 3). */
  minSamplesBanded?: number;
  /** Minimum comparable events when the target buy-in is unknown → unfiltered (default 5, stricter). */
  minSamplesUnbanded?: number;
}

/** Linear-interpolation percentile over an ASC-sorted numeric array (q in [0,1]). */
function percentile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 0) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = (sortedAsc.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function roundInt(n: number): number {
  return Math.max(0, Math.round(n));
}

/**
 * Suggest low/base/high entries for an upcoming event from comparable past turnouts.
 * @param targetEventId  the event being forecast (excluded from its own history).
 * @param targetBuyIn    the event's buy-in (drives the comparable band); null → unbanded fallback.
 * @param history        the club's own SeriesEvents (finished ones carry real entry counts).
 */
export function forecastSuggest(
  targetEventId: string,
  targetBuyIn: number | null,
  history: SeriesEvent[],
  opts: ForecastSuggestOptions = {},
): ForecastSuggestion {
  const band = opts.buyInBand ?? 2;
  const minBanded = opts.minSamplesBanded ?? 3;
  const minUnbanded = opts.minSamplesUnbanded ?? 5;

  // Only FINISHED events with real, positive entry counts, never the target itself.
  const finished = history.filter(
    (e) => e.event_id !== targetEventId && e.total_entries != null && e.total_entries > 0,
  );

  const banded = targetBuyIn != null && targetBuyIn > 0 && Number.isFinite(band) && band > 1;
  const bandLow = banded ? targetBuyIn! / band : null;
  const bandHigh = banded ? targetBuyIn! * band : null;

  const comparable = banded
    ? finished.filter((e) => e.buy_in != null && e.buy_in >= bandLow! && e.buy_in <= bandHigh!)
    : finished;

  const sampleSize = comparable.length;
  const comparableEventIds = comparable.map((e) => e.event_id);
  const minNeeded = banded ? minBanded : minUnbanded;

  if (sampleSize < minNeeded) {
    return {
      status: "insufficient",
      low: null,
      base: null,
      high: null,
      sampleSize,
      comparableEventIds,
      bandLow,
      bandHigh,
      reason: banded
        ? `Chưa đủ giải cùng tầm buy-in để gợi ý (mới có ${sampleSize}, cần ≥ ${minNeeded}). Cứ tự nhập theo kinh nghiệm.`
        : `Chưa biết buy-in của giải này; cần ≥ ${minNeeded} giải đã có kết quả để gợi ý (mới có ${sampleSize}).`,
    };
  }

  const entries = comparable.map((e) => e.total_entries as number).sort((a, b) => a - b);
  const base = roundInt(percentile(entries, 0.5));
  const low = roundInt(percentile(entries, 0.2));
  const high = roundInt(percentile(entries, 0.8));

  const reason = banded
    ? `Dựa trên ${sampleSize} giải cùng tầm buy-in (${roundInt(bandLow!).toLocaleString("vi-VN")}–${roundInt(bandHigh!).toLocaleString("vi-VN")}₫). Đây là số ĐÃ QUAN SÁT từ CLB của bạn, không phải mô hình dự đoán — bạn cứ chỉnh lại.`
    : `Dựa trên ${sampleSize} giải đã có kết quả (mọi mức buy-in vì chưa biết buy-in giải này). Số ĐÃ QUAN SÁT, không phải dự đoán.`;

  return { status: "ok", low, base, high, sampleSize, comparableEventIds, bandLow, bandHigh, reason };
}
