// Satellite payout — cơ cấu trả thưởng NHẬP TAY cho giải vé (satellite): mỗi dòng là 1 khoảng hạng
// (label, VD "1–12") + phần thưởng tự do (prize, VD "1 vé" hoặc "4.500.000"). KHÔNG qua payout engine
// (không Σ=pool, không snapshot/close) — operator tự tính, hệ chỉ lưu + hiển thị. Lưu ở
// `tournaments.satellite_payout` (jsonb) = { rows: [{ label, prize }] }.

export interface SatellitePrizeRow {
  label: string;
  prize: string;
}
export interface SatellitePayout {
  rows: SatellitePrizeRow[];
}

/**
 * Rows đủ điều kiện HIỂN THỊ: label VÀ prize đều non-blank. Null nếu không có gì đáng hiện.
 * ĐỊNH NGHĨA DUY NHẤT cho "giải này có satellite để hiển thị" — Cockpit (OpsTournamentCockpit S5)
 * và TV (TvPayoutsScreen) PHẢI cùng dùng hàm này, không tự tính lại (tránh 2 màn lệch nhau:
 * một màn ẩn bảng tiền, màn kia không). Deterministic, không mutate input.
 * Row dở dang (chỉ label hoặc chỉ prize) / payload toàn dòng trắng ⇒ KHÔNG displayable ⇒ null
 * ⇒ các màn fallback về bảng tiền như cũ — không bao giờ ra màn trống.
 */
export function getDisplayableSatelliteRows(
  payout: SatellitePayout | null | undefined,
  enabled: boolean,
): SatellitePrizeRow[] | null {
  if (!enabled || !payout || !Array.isArray(payout.rows)) return null;
  const rows = payout.rows.filter((r) => r.label.trim() !== "" && r.prize.trim() !== "");
  return rows.length > 0 ? rows : null;
}

/** Parse jsonb thô từ DB → SatellitePayout (bỏ dòng rỗng); null nếu không có dữ liệu hợp lệ. */
export function parseSatellitePayout(raw: unknown): SatellitePayout | null {
  if (!raw || typeof raw !== "object") return null;
  const rows = (raw as { rows?: unknown }).rows;
  if (!Array.isArray(rows)) return null;
  const clean: SatellitePrizeRow[] = rows
    .map((r) => ({
      label: String((r as { label?: unknown })?.label ?? "").trim(),
      prize: String((r as { prize?: unknown })?.prize ?? "").trim(),
    }))
    .filter((r) => r.label !== "" || r.prize !== "");
  return clean.length > 0 ? { rows: clean } : null;
}
