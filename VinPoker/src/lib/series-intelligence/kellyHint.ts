// Series Intelligence — fractional-Kelly bankroll hint (PURE, testable).
//
// Answers ONE humble question for the owner: "given the reserve capital I typed in, is this
// festival's GTD commitment over-aggressive?" It is a REFERENCE, never a recommendation.
//
// HONESTY (locked):
//  - Bankroll is ALWAYS owner-entered — never inferred from data.
//  - σ is APPROXIMATED from the P5–P95 spread assuming a roughly-normal profit distribution
//    (P5..P95 ≈ ±1.645σ ⇒ range ≈ 3.29σ). This is disclosed in `caveat`.
//  - Kelly assumes a repeatable bet + log-growth utility — a reference frame, not a rule.
//  - Only meaningful in PROFIT mode (a real cost was entered); otherwise unavailable.
//
// Math (2nd-order log-growth, profit ~ N(μ, σ²) in VND):
//  full-Kelly bankroll  B* = σ²/μ   (μ>0)   — the bankroll at which full-Kelly sizes THIS bet.
//  Running with reserve B: B<B* = over-betting (ruin risk); B≥B* = progressively safer.
//  Fractional Kelly is safer → needs MORE bankroll: half-Kelly wants B≥2·B*, quarter-Kelly B≥4·B*.

/** P5..P95 spans ~90% of a normal ⇒ ±1.645σ ⇒ full range ≈ 3.29σ. */
const P5_P95_SIGMA_SPAN = 3.29;

export type KellyVerdict =
  | "negative-ev" // μ ≤ 0 → Kelly says do not commit at this GTD structure
  | "over-committed" // B < B* (below full-Kelly bankroll) — ruin risk
  | "aggressive" // B* ≤ B < 2·B* (below half-Kelly)
  | "acceptable" // 2·B* ≤ B < 4·B* (between half- and quarter-Kelly)
  | "conservative" // B ≥ 4·B* (at/above quarter-Kelly)
  | "insufficient-data"; // not profit mode / no bankroll / σ ≤ 0

export interface KellyHintInput {
  /** E[profit] in VND — SimResult.eEV. null (gross mode) ⇒ unavailable. */
  eEV: number | null;
  p5: number;
  p95: number;
  /** Owner-entered reserve capital (VND). null/≤0 ⇒ unavailable. Never inferred. */
  bankroll: number | null;
  mode: "gross" | "profit";
}

export interface KellyHintResult {
  available: boolean;
  verdict: KellyVerdict;
  /** (p95 − p5) / 3.29, or null when not derivable. */
  sigmaApprox: number | null;
  /** B* = σ²/μ (full-Kelly bankroll), null unless μ>0 & σ>0. */
  fullKellyBankroll: number | null;
  /** 2·B* — reserve needed to run at half-Kelly. */
  halfKellyBankroll: number | null;
  /** 4·B* — reserve needed to run at the (safest) quarter-Kelly. */
  quarterKellyBankroll: number | null;
  bankroll: number | null;
  headline: string;
  caveat: string;
}

const CAVEAT =
  "σ ước lượng từ P5–P95 (giả định phân phối gần chuẩn) · Kelly giả định cược lặp lại nhiều lần + " +
  "tối ưu tăng trưởng log · CHỈ tham khảo, không phải khuyến nghị bắt buộc. Vốn dự phòng do bạn tự nhập.";

function unavailable(sigmaApprox: number | null, bankroll: number | null): KellyHintResult {
  return {
    available: false,
    verdict: "insufficient-data",
    sigmaApprox,
    fullKellyBankroll: null,
    halfKellyBankroll: null,
    quarterKellyBankroll: null,
    bankroll,
    headline: "",
    caveat: CAVEAT,
  };
}

const fmtTr = (v: number): string => `${Math.round(v / 1e5) / 10} tr`; // VND → triệu (1 decimal)

/**
 * Compute a fractional-Kelly reserve-capital hint from a festival EV distribution.
 * Pure + deterministic. Returns `available:false` (verdict "insufficient-data") whenever the inputs
 * cannot support an honest statement (gross mode, no/þ≤0 bankroll, or zero spread).
 */
export function computeKellyHint(input: KellyHintInput): KellyHintResult {
  const bankroll = input.bankroll;
  // Gate 1: needs a real cost (profit mode) + a positive owner-entered bankroll.
  if (input.mode !== "profit" || bankroll === null || bankroll <= 0) return unavailable(null, bankroll ?? null);

  const mu = input.eEV;
  const sigma = (input.p95 - input.p5) / P5_P95_SIGMA_SPAN;
  // Gate 2: need a positive spread to speak about risk at all.
  if (sigma <= 0) return unavailable(sigma <= 0 ? null : sigma, bankroll);
  if (mu === null) return unavailable(sigma, bankroll);

  // Negative/zero edge: Kelly says don't take the bet. No bankroll number is meaningful.
  if (mu <= 0) {
    return {
      available: true,
      verdict: "negative-ev",
      sigmaApprox: sigma,
      fullKellyBankroll: null,
      halfKellyBankroll: null,
      quarterKellyBankroll: null,
      bankroll,
      headline:
        "Lời kỳ vọng ≤ 0 → theo Kelly, KHÔNG nên cam kết cấu trúc GTD này (giảm GTD hoặc α trước khi chạy).",
      caveat: CAVEAT,
    };
  }

  const full = (sigma * sigma) / mu; // B* = σ²/μ
  const half = 2 * full;
  const quarter = 4 * full;

  let verdict: KellyVerdict;
  let headline: string;
  if (bankroll >= quarter) {
    verdict = "conservative";
    headline = `Vốn dự phòng ${fmtTr(bankroll)} ≥ mức ¼-Kelly (${fmtTr(quarter)}) → thận trọng, an toàn theo Kelly.`;
  } else if (bankroll >= half) {
    verdict = "acceptable";
    headline = `Vốn dự phòng ${fmtTr(bankroll)} nằm giữa ½-Kelly (${fmtTr(half)}) và ¼-Kelly (${fmtTr(quarter)}) → chấp nhận được.`;
  } else if (bankroll >= full) {
    verdict = "aggressive";
    headline = `Vốn dự phòng ${fmtTr(bankroll)} dưới mức ½-Kelly (${fmtTr(half)}) → hơi mạo hiểm, cân nhắc giảm GTD/α.`;
  } else {
    verdict = "over-committed";
    headline = `Vốn dự phòng ${fmtTr(bankroll)} DƯỚI mức full-Kelly (${fmtTr(full)}) → quá tay, rủi ro cụt vốn cao. Giảm GTD/α.`;
  }

  return {
    available: true,
    verdict,
    sigmaApprox: sigma,
    fullKellyBankroll: full,
    halfKellyBankroll: half,
    quarterKellyBankroll: quarter,
    bankroll,
    headline,
    caveat: CAVEAT,
  };
}
