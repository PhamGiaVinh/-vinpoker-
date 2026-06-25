// marketing-autocontent — money/time/date helpers. Uses the SAME Intl calls as src/lib/format.ts
// (vi-VN currency, Asia/Ho_Chi_Minh) so auto-generated text matches manually-composed text (P2-10).
// Vietnam has no DST (fixed UTC+7), so date math uses a fixed +7h offset.

const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

/** "1.500.000 ₫" — matches src/lib/format.ts formatVND. */
export function formatVND(n: number): string {
  return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND", maximumFractionDigits: 0 }).format(n || 0);
}

/** "HH:MM" in Vietnam time from an ISO/timestamptz string. */
export function fmtTimeVN(iso: string): string {
  return new Date(iso).toLocaleTimeString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/** Vietnam calendar date (YYYY-MM-DD) for today + offsetDays. */
export function vnDateStr(offsetDays = 0): string {
  return new Date(Date.now() + VN_OFFSET_MS + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** Vietnam wall-clock hour (0-23) right now. */
export function vnHour(): number {
  return new Date(Date.now() + VN_OFFSET_MS).getUTCHours();
}

/** "DD/MM" from a YYYY-MM-DD date string. */
export function ddmm(dateStr: string): string {
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}
