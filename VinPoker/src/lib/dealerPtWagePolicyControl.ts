export const PT_WAGE_POLICY_REASON_LIMIT = 500;

export interface DealerPtWagePolicyRequest {
  p_club_id: string;
  p_standby_accrual_enabled: boolean;
  p_effective_from: null;
  p_reason: string;
}

export interface DealerPtWageGlobalPolicyRequest {
  p_standby_accrual_enabled: boolean;
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
    // NULL tells the forward-only server contract to choose its own activation
    // instant. The client cannot choose a historical boundary or send money.
    p_effective_from: null,
    p_reason: trimmedReason,
  };
}

/**
 * The global action intentionally has no club list, timestamp, rate, or wage
 * amount. The server locks the approved-club set and captures one boundary.
 */
export function buildDealerPtWageGlobalPolicyRequest(
  standbyAccrualEnabled: boolean,
  reason: string,
): DealerPtWageGlobalPolicyRequest {
  const trimmedReason = reason.trim();

  if (!trimmedReason) {
    throw new Error("Cần nhập lý do để ghi nhận thay đổi chính sách toàn hệ thống.");
  }
  if (trimmedReason.length > PT_WAGE_POLICY_REASON_LIMIT) {
    throw new Error(`Lý do tối đa ${PT_WAGE_POLICY_REASON_LIMIT} ký tự.`);
  }

  return {
    p_standby_accrual_enabled: standbyAccrualEnabled,
    p_reason: trimmedReason,
  };
}
