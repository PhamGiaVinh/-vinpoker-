export const NORMAL_CHECKOUT_MAX_AGE_HOURS = 24;

export function requiresStaleCheckoutCleanup(
  checkInTime: string | null,
  nowMs = Date.now(),
): boolean {
  if (!checkInTime) return true;
  const checkInMs = new Date(checkInTime).getTime();
  if (!Number.isFinite(checkInMs) || checkInMs > nowMs) return true;
  return nowMs - checkInMs > NORMAL_CHECKOUT_MAX_AGE_HOURS * 60 * 60 * 1000;
}
