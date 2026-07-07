// Series Intelligence — W6 registration-pace check (PURE, honest). Before a giải: is sign-up on track
// vs the forecast? We DON'T have a real registration-pace curve (how a field fills over time), so we do
// NOT fake one. The reference here is a CRUDE linear pace (sign-ups spread evenly over the reg window),
// stated plainly as a rough guide — real poker sign-up back-loads to the last day/hours. All inputs are
// owner-entered; the status is a Hypothesis, not a claim.

export type RegPaceStatus = "ahead" | "on-track" | "behind" | "unknown";

export interface RegPaceInput {
  /** Forecast total field (from the turnout forecast or the owner). null → only a raw count is shown. */
  forecast: number | null;
  /** Sign-ups so far (owner-entered). */
  current: number;
  /** Days the registration has been open. */
  daysOpen: number;
  /** Days left until the giải. */
  daysLeft: number;
}

export interface RegPaceResult {
  available: boolean;
  /** current / forecast, %. null when no forecast. */
  pctOfForecast: number | null;
  /** CRUDE linear expectation by now = forecast × daysOpen/(daysOpen+daysLeft). null when N/A. */
  linearExpected: number | null;
  /** current − linearExpected. */
  gapVsLinear: number | null;
  status: RegPaceStatus;
  headline: string;
  caveat: string;
}

const CAVEAT =
  "Mốc \"nên có\" là giả định THÔ: đăng ký rải đều theo thời gian. Thực tế poker thường dồn ngày/giờ chót → " +
  "chậm ở giữa kỳ là bình thường. Đây là tín hiệu tham khảo (giả thuyết), không phải kết luận.";

/**
 * Compare owner-entered sign-ups-so-far to a crude linear pace toward the forecast. Pure + deterministic.
 * `unknown` status whenever there's no forecast or no elapsed window to project from.
 */
export function registrationPace(input: RegPaceInput): RegPaceResult {
  const { forecast, current, daysOpen, daysLeft } = input;
  const total = daysOpen + daysLeft;

  if (forecast === null || forecast <= 0 || total <= 0 || daysOpen < 0) {
    return {
      available: forecast !== null && forecast > 0,
      pctOfForecast: forecast && forecast > 0 ? Math.round((current / forecast) * 100) : null,
      linearExpected: null,
      gapVsLinear: null,
      status: "unknown",
      headline:
        forecast && forecast > 0
          ? `Đã ${current} đăng ký · dự báo cuối ${forecast} (${Math.round((current / forecast) * 100)}%).`
          : `Đã ${current} đăng ký. Nhập dự báo cuối để so nhịp.`,
      caveat: CAVEAT,
    };
  }

  const linearExpected = Math.round(forecast * (daysOpen / total));
  const gapVsLinear = current - linearExpected;
  const pctOfForecast = Math.round((current / forecast) * 100);

  // Behind if meaningfully under the crude line (>10% of forecast below); ahead if similarly above.
  const band = Math.max(1, Math.round(forecast * 0.1));
  const status: RegPaceStatus = gapVsLinear < -band ? "behind" : gapVsLinear > band ? "ahead" : "on-track";

  const label = status === "behind" ? "đang chậm" : status === "ahead" ? "đang nhanh" : "đúng nhịp (thô)";
  const headline = `Đã ${current} đăng ký · mốc thô tới giờ ~${linearExpected} · dự báo cuối ${forecast} → ${label}.`;

  return { available: true, pctOfForecast, linearExpected, gapVsLinear, status, headline, caveat: CAVEAT };
}
