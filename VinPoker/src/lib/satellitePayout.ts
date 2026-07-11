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
