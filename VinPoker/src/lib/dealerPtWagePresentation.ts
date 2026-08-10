export type PtWageAccrualMode = "capped_24h" | "continuous_standby";

export interface PtWageAccrualState {
  current_shift_open?: boolean;
  accrual_mode?: PtWageAccrualMode | string | null;
  standby_accrual_enabled?: boolean;
  current_shift_cap_reached?: boolean;
  live_accrual_active?: boolean;
}

export interface PtWageAccrualPresentation {
  mode: PtWageAccrualMode;
  isLiveAccruing: boolean;
  label: string;
  note: string;
}

/**
 * Projects the read-only display between server refreshes. The persisted balance
 * remains server-owned; elapsed time is clamped so clock drift cannot subtract pay.
 */
export function projectPtWageBalanceVnd(
  serverBalanceVnd: number,
  hourlyRateVnd: number,
  elapsedMs: number,
  isLiveAccruing: boolean,
): number {
  const balance = Math.max(0, Math.floor(serverBalanceVnd));
  if (!isLiveAccruing) return balance;

  const safeElapsedMs = Math.max(0, elapsedMs);
  const safeHourlyRate = Math.max(0, hourlyRateVnd);
  return balance + Math.floor((safeElapsedMs / 3_600_000) * safeHourlyRate);
}

export function ptWageRatePerSecondVnd(hourlyRateVnd: number): number {
  return Math.max(0, hourlyRateVnd) / 3_600;
}

/**
 * The amount remains server-authoritative. This helper only decides whether a
 * one-second display estimate may advance between server refreshes.
 */
export function getPtWageAccrualPresentation(
  state: PtWageAccrualState,
): PtWageAccrualPresentation {
  const continuous = state.accrual_mode === "continuous_standby" ||
    state.standby_accrual_enabled === true;
  const capped = state.current_shift_cap_reached === true;
  const isLiveAccruing = state.current_shift_open === true &&
    state.live_accrual_active !== false;

  if (continuous) {
    return {
      mode: "continuous_standby",
      isLiveAccruing,
      label: "Tích lũy ca + thời gian chờ pool",
      note: "Tính từ mốc chính sách do máy chủ xác nhận và sau kỳ chi trả gần nhất, gồm thời gian chờ trong pool.",
    };
  }

  if (capped) {
    return {
      mode: "capped_24h",
      isLiveAccruing: false,
      label: "Đã chạm giới hạn 24 giờ",
      note:
        "Chính sách hiện tại giới hạn mỗi lần check-in 24 giờ; số dư sẽ không tăng thêm.",
    };
  }

  return {
    mode: "capped_24h",
    isLiveAccruing,
    label: "Tích lũy theo check-in",
    note: "Tính từ kỳ chi trả gần nhất và cập nhật trực tiếp từ máy chủ.",
  };
}
