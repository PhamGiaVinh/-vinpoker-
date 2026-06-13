// Pure, testable helpers for the Club Admin → Owner Finance Dashboard (read-only).
// NO database access here (see useClubFinanceSummary for fetching/aggregation).
// Locked revenue model (owner-approved 2026-06-14):
//   Doanh thu thật = staking fees + staking payout fees + tournament rake
//   Net = doanh thu − SAVED dealer payroll (never recomputed)
// Excluded from Net: buy-in, staking capital, cashier-cash, bankroll_entries.rake,
// platform_fee_config, club_wallets, F&B (future module).

export type PayrollStatusKey =
  | "draft" | "submitted" | "approved" | "locked"
  | "payment_prepared" | "paid" | "reconciled" | "rejected" | "other";

export const PAYROLL_STATUS_META: Record<PayrollStatusKey, { label: string; tone: string }> = {
  draft: { label: "Nháp", tone: "#5f6670" },
  submitted: { label: "Đã nộp", tone: "#85B7EB" },
  approved: { label: "Đã duyệt", tone: "#378ADD" },
  locked: { label: "Đã khoá", tone: "#EF9F27" },
  payment_prepared: { label: "Chờ chi trả", tone: "#BA7517" },
  paid: { label: "Đã trả", tone: "#00c46e" },
  reconciled: { label: "Đã đối soát", tone: "#1D9E75" },
  rejected: { label: "Từ chối", tone: "#E24B4A" },
  other: { label: "Khác", tone: "#888780" },
};

const KNOWN_STATUSES = new Set<string>(Object.keys(PAYROLL_STATUS_META));

export const normalizeStatus = (s: string | null | undefined): PayrollStatusKey => {
  const k = (s ?? "").toLowerCase().trim();
  return (KNOWN_STATUSES.has(k) ? k : "other") as PayrollStatusKey;
};

// Periods considered "unpaid / owed" (used for the aging chart + unpaid KPI).
export const UNPAID_STATUSES: PayrollStatusKey[] = ["submitted", "approved", "locked", "payment_prepared"];
export const isUnpaid = (s: string | null | undefined): boolean =>
  UNPAID_STATUSES.includes(normalizeStatus(s));

export type AgingBucketKey = "d0_30" | "d31_60" | "d61_90" | "d90p";
export const AGING_BUCKETS: { key: AgingBucketKey; label: string; tone: string }[] = [
  { key: "d0_30", label: "0–30", tone: "#00c46e" },
  { key: "d31_60", label: "31–60", tone: "#EF9F27" },
  { key: "d61_90", label: "61–90", tone: "#F0997B" },
  { key: "d90p", label: "90+", tone: "#E24B4A" },
];

export const agingBucket = (days: number): AgingBucketKey =>
  days <= 30 ? "d0_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90p";

export const daysBetween = (fromIso: string, nowMs: number): number => {
  const t = new Date(fromIso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((nowMs - t) / 86_400_000));
};

export const margin = (net: number, revenue: number): number =>
  revenue > 0 ? net / revenue : 0;

export const formatPct = (x: number): string => `${Math.round(x * 100)}%`;

// "YYYY-MM-DD..." → "YYYY-MM"
export const monthKey = (iso: string): string => (iso ?? "").slice(0, 7);

// "2026-06" → "06/26"
export const monthLabel = (mk: string): string =>
  mk.length >= 7 ? `${mk.slice(5, 7)}/${mk.slice(2, 4)}` : mk;

// Compact VND for axis ticks / tight labels: 1_234_000 → "1,2tr", 2_500_000_000 → "2,5tỷ".
export const formatVndShort = (n: number): string => {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const trim = (s: string) => s.replace(/\.0$/, "").replace(".", ",");
  if (abs >= 1_000_000_000) return `${sign}${trim((abs / 1_000_000_000).toFixed(1))}tỷ`;
  if (abs >= 1_000_000) return `${sign}${trim((abs / 1_000_000).toFixed(1))}tr`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}k`;
  return `${sign}${Math.round(abs)}`;
};
