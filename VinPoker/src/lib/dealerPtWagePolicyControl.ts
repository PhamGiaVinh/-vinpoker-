export const PT_WAGE_POLICY_REASON_LIMIT = 500;

export interface DealerPtWagePolicyRequest {
  p_club_id: string;
  p_standby_accrual_enabled: boolean;
  p_effective_from: null;
  p_reason: string;
}

/**
 * The server owns authorization and all balance math. The web control can only
 * request the documented per-club policy with a bounded audit reason.
 */
export function buildDealerPtWagePolicyRequest(
  clubId: string,
  standbyAccrualEnabled: boolean,
  reason: string,
): DealerPtWagePolicyRequest {
  const trimmedReason = reason.trim();

  if (!clubId) {
    throw new Error("Cần chọn câu lạc bộ trước khi đổi chính sách lương.");
  }
  if (!trimmedReason) {
    throw new Error("Cần nhập lý do để ghi nhận thay đổi chính sách.");
  }
  if (trimmedReason.length > PT_WAGE_POLICY_REASON_LIMIT) {
    throw new Error(`Lý do tối đa ${PT_WAGE_POLICY_REASON_LIMIT} ký tự.`);
  }

  return {
    p_club_id: clubId,
    p_standby_accrual_enabled: standbyAccrualEnabled,
    // NULL is the audited all-unpaid-minutes option. The client never chooses
    // an arbitrary historical boundary or sends a balance/payment amount.
    p_effective_from: null,
    p_reason: trimmedReason,
  };
}
